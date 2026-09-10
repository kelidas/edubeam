import { Beam2D, BeamConcentratedDeformation, BeamConcentratedLoad, type LoadCase } from 'ts-fem';

/**
 * What an element carries at a section, rather than only at its ends.
 *
 * ts-fem evaluates all of it at an arbitrary distance already - `computeNormalForceAt` and its
 * siblings - so nothing is interpolated here between the points the drawing happens to sample.
 * That matters: the diagrams are drawn from as few points as each quantity needs (a normal force is
 * linear, so two), and reading a value off that polyline would be a different number from the one
 * the solver gives.
 *
 * `x` is a distance from the element's start node along its axis, in metres, which is what those
 * methods take despite the parameter being named `xi` in the library's typings.
 */
export interface SectionResult {
  /** Distance from the start node, along the element. */
  x: number;
  /** Normal force. */
  n: number;
  /** Shear force. */
  vz: number;
  /** Bending moment. */
  my: number;
  /** Deflection along the element, in its own axes. */
  u: number;
  /** Deflection across the element, in its own axes. */
  w: number;
  /** Rotation of the cross section, in radians. */
  phi: number;
  /**
   * Which side of a jump the section is on, where it sits at one: two sections share a distance
   * and carry different values. Absent everywhere the results are continuous.
   */
  side?: -1 | 1;
}

/**
 * How far either side of a jump a section is taken.
 *
 * A point load leaves the shear with two values at its own distance and no value at all, and the
 * same goes for a moment, an axial load and a concentrated deformation. Asking a hair either side
 * is what the drawing does - this is its own offset - so the table and the diagram agree with it
 * rather than each picking their own idea of "just before".
 */
const EITHER_SIDE = 1e-7;

export const elementLength = (element: Beam2D) => element.computeGeo().l;

/**
 * The distances along the element where the results jump.
 *
 * Everything applied at a point does it: a force to the shear, an axial force to the normal force,
 * a moment to the bending moment, a concentrated deformation to the deflection. One is the load's
 * own distance, and there is nothing to read exactly at it.
 */
export const discontinuities = (element: Beam2D, loadCase: LoadCase): number[] => {
  const length = elementLength(element);

  return loadCase
    .getElementLoadsOnElement(element.label)
    .filter((load) => load instanceof BeamConcentratedLoad || load instanceof BeamConcentratedDeformation)
    .map((load) => (load as BeamConcentratedLoad).values[3])
    .filter((at) => Number.isFinite(at) && at > EITHER_SIDE && at < length - EITHER_SIDE)
    .sort((a, b) => a - b);
};

/**
 * The rotation of the cross section, as the slope of the deflection curve.
 *
 * ts-fem evaluates the deflection but not its derivative, so this is the one quantity here that is
 * not read straight out of the library. It is differenced rather than re-derived: the deflection
 * curve is Hermite - a cubic in the end displacements plus each load's own contribution - and
 * writing its derivative out by hand would mean copying that formulation and then having to keep
 * the copy in step with it.
 *
 * The sign follows from the same Hermite form, in which the end rotation multiplies -ξ + 2ξ² - ξ³:
 * the rotation is minus the slope, so at the ends this gives back exactly the nodal rotations the
 * solver found, which is what the tests hold it to.
 */
/**
 * The stretch of the element a section belongs to: from the last jump before it to the next after.
 *
 * The deflection curve is only a curve between the discontinuities. A section just before a point
 * load belongs to the stretch that ends there, and nothing beyond it says anything about the slope
 * on this side of it.
 */
const stretchAround = (x: number, length: number, jumps: number[]): [number, number] => {
  let low = 0;
  let high = length;

  for (const jump of jumps) {
    if (jump < x && jump > low) low = jump;
    if (jump > x && jump < high) high = jump;
    // asked at a jump rather than either side of it, which is a section that has two values: the
    // one after it is the one given, so that a number comes back rather than an average of both
    if (jump === x) low = jump;
  }

  return [low, high];
};

/**
 * The rotation of the cross section, as the slope of the deflection curve on its own side of any
 * jump.
 *
 * Differencing has to stay inside the stretch the section belongs to. A centred difference across a
 * concentrated deformation straddles the jump and returns it divided by the step - radians, where
 * the beam turns by a thousandth of one - and across a concentrated moment it averages the two
 * different slopes either side and is wrong on both. Where the stretch has room on both sides the
 * difference is centred; otherwise it is three points reaching inwards, which is as accurate.
 */
const rotationAt = (element: Beam2D, loadCase: LoadCase, x: number, length: number, jumps: number[] = []): number => {
  const w = (at: number) => element.computeLocalDeflAt(loadCase, at).w;
  const [low, high] = stretchAround(x, length, jumps);
  const h = Math.max(Math.min(length * 1e-4, (high - low) / 4), 1e-12);

  // a centred difference wherever the stretch is wide enough for one on both sides
  if (x - h >= low && x + h <= high) return -(w(x + h) - w(x - h)) / (2 * h);

  const inwards = x - h < low ? 1 : -1;

  return (-inwards * (-3 * w(x) + 4 * w(x + inwards * h) - w(x + 2 * inwards * h))) / (2 * h);
};

/** Everything at one section. Positions outside the element are pulled back onto it. */
const sectionAt = (element: Beam2D, loadCase: LoadCase, x: number, length: number, jumps: number[]): SectionResult => {
  const at = Math.min(Math.max(x, 0), length);
  const deflection = element.computeLocalDeflAt(loadCase, at);

  return {
    x: at,
    n: element.computeNormalForceAt(loadCase, at),
    vz: element.computeShearForceAt(loadCase, at),
    my: element.computeBendingMomentAt(loadCase, at),
    u: deflection.u,
    w: deflection.w,
    phi: rotationAt(element, loadCase, at, length, jumps),
  };
};

export const resultsAt = (element: Beam2D, loadCase: LoadCase, x: number): SectionResult =>
  sectionAt(element, loadCase, x, elementLength(element), discontinuities(element, loadCase));

/**
 * The element cut into equal pieces, ends included: `divisions + 1` sections.
 *
 * Both ends are always there, which is where the discontinuities live - a support reaction or a
 * point load makes the shear jump, and the pair either side of it is what shows that.
 */
export const resultsAlong = (element: Beam2D, loadCase: LoadCase, divisions: number): SectionResult[] => {
  const steps = Math.max(1, Math.floor(divisions));
  const length = elementLength(element);
  const jumps = discontinuities(element, loadCase);

  const regular = Array.from({ length: steps + 1 }, (_, i) => (length * i) / steps)
    // a division landing on a jump has no value of its own: the pair either side is what it has
    .filter((x) => !jumps.some((jump) => Math.abs(jump - x) <= EITHER_SIDE))
    .map((x) => sectionAt(element, loadCase, x, length, jumps));

  const sides = jumps.flatMap((jump) => [
    { ...sectionAt(element, loadCase, jump - EITHER_SIDE, length, jumps), side: -1 as const },
    { ...sectionAt(element, loadCase, jump + EITHER_SIDE, length, jumps), side: 1 as const },
  ]);

  return [...regular, ...sides].sort((a, b) => a.x - b.x);
};

export type SectionQuantity = 'n' | 'vz' | 'my' | 'u' | 'w' | 'phi';

/**
 * What each quantity's own rate of change along the element is, where the structure gives it.
 *
 * These are the relations the whole subject rests on: the shear is the slope of the moment, the
 * curvature - and so the moment - is the slope of the rotation, the rotation is the slope of the
 * deflection, and the normal force is the slope of the axial displacement. So a quantity is
 * stationary exactly where the one paired with it passes through zero, and that can be solved for
 * rather than looked for.
 *
 * The shear and the normal force are missing on purpose: their own rates of change are the loads,
 * which are constant along a stretch and jump at a point load. They have no stationary point
 * inside a stretch - their extremes sit at the ends and either side of a jump.
 */
const SLOPE_OF: Partial<Record<SectionQuantity, SectionQuantity>> = {
  my: 'vz',
  phi: 'my',
  w: 'phi',
  u: 'n',
};

const valueAt = (
  element: Beam2D,
  loadCase: LoadCase,
  quantity: SectionQuantity,
  x: number,
  jumps: number[]
): number => {
  if (quantity === 'n') return element.computeNormalForceAt(loadCase, x);
  if (quantity === 'vz') return element.computeShearForceAt(loadCase, x);
  if (quantity === 'my') return element.computeBendingMomentAt(loadCase, x);
  if (quantity === 'phi') return rotationAt(element, loadCase, x, elementLength(element), jumps);

  return element.computeLocalDeflAt(loadCase, x)[quantity];
};

/**
 * Where a quantity turns, inside the element rather than at its ends.
 *
 * Read against the exact relation above rather than off the sections on show: the peak of a moment
 * almost never falls on a regular division, and it is usually the one place on the beam anyone
 * actually wants a number from. The bracket is found by sampling and then closed by halving, so
 * what comes back is the root itself and not the finest sample.
 *
 * Only a strict change of sign counts as a bracket. A stretch where the shear is exactly zero is a
 * stretch where the moment is constant - every point of it is stationary, and none of them is the
 * peak - so it is passed over rather than reported as a root.
 */
export const stationaryPoints = (
  element: Beam2D,
  loadCase: LoadCase,
  quantity: SectionQuantity,
  samples = 200
): number[] => {
  const slope = SLOPE_OF[quantity];

  if (!slope) return [];

  const length = elementLength(element);
  const jumps = discontinuities(element, loadCase);
  const at = (x: number) => valueAt(element, loadCase, slope, x, jumps);
  const tolerance = length * 1e-9;

  const xs = Array.from({ length: samples + 1 }, (_, i) => (length * i) / samples);
  const values = xs.map(at);
  const peak = values.reduce((max, value) => (Number.isFinite(value) ? Math.max(max, Math.abs(value)) : max), 0);

  // nothing to cross zero: the quantity does not change along the element at all
  if (peak === 0) return [];

  const negligible = peak * 1e-9;
  const roots: number[] = [];

  for (let i = 0; i < samples; i++) {
    const [a, b] = [values[i], values[i + 1]];

    // a load the model cannot evaluate would otherwise be reported as a root at every sample
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

    // a plateau of zeros is a stretch where the quantity is constant - every point of it is
    // stationary and none of them is the peak - and so is a pair too small to be anything but the
    // residue of the solve
    if (Math.abs(a) + Math.abs(b) < negligible) continue;
    if (a * b > 0) continue;

    let root: number;

    if (a === 0) {
      root = xs[i];
    } else if (b === 0) {
      root = xs[i + 1];
    } else {
      // closed by halving, so what comes back is the root and not the finest sample
      let low = xs[i];
      let high = xs[i + 1];
      let lowValue = a;

      while (high - low > tolerance) {
        const middle = (low + high) / 2;
        const value = at(middle);

        if (lowValue * value <= 0) {
          high = middle;
        } else {
          low = middle;
          lowValue = value;
        }
      }

      root = (low + high) / 2;
    }

    // the ends are already places the reader can reach, and a root landing on a sample is found
    // twice - once from either side
    if (root <= tolerance || root >= length - tolerance) continue;
    if (roots.some((found) => Math.abs(found - root) <= length * 1e-6)) continue;

    roots.push(root);
  }

  return roots;
};

/**
 * Where each quantity reaches furthest from zero, by index into the sections given.
 *
 * Read off the same sections the table shows rather than solved for: a true extreme sits wherever
 * the derivative vanishes, which no finite set of sections is bound to contain. It marks the
 * largest value *on show*, which is what someone comparing rows is looking for - so the marking
 * gets finer as the divisions do, and never claims more than the table can support.
 */
export const extremesOf = (sections: SectionResult[]): Record<SectionQuantity, number> => {
  const quantities: SectionQuantity[] = ['n', 'vz', 'my', 'u', 'w', 'phi'];
  const found = {} as Record<SectionQuantity, number>;

  for (const quantity of quantities) {
    let best = -1;
    let largest = 0;

    sections.forEach((section, i) => {
      const size = Math.abs(section[quantity]);

      // a strict comparison keeps the first of equal values rather than the last
      if (size > largest + 1e-30) {
        largest = size;
        best = i;
      }
    });

    found[quantity] = best;
  }

  return found;
};
