import { Beam2D, type LoadCase } from 'ts-fem';

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
}

export const elementLength = (element: Beam2D) => element.computeGeo().l;

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
const rotationAt = (element: Beam2D, loadCase: LoadCase, x: number, length: number): number => {
  const w = (at: number) => element.computeLocalDeflAt(loadCase, at).w;
  const h = Math.max(length * 1e-4, 1e-9);

  // a centred difference wherever the element is wide enough for one on both sides
  if (x - h >= 0 && x + h <= length) return -(w(x + h) - w(x - h)) / (2 * h);

  // and at an end, three points reaching inwards, which is as accurate as the centred one
  const inwards = x - h < 0 ? 1 : -1;

  return (-inwards * (-3 * w(x) + 4 * w(x + inwards * h) - w(x + 2 * inwards * h))) / (2 * h);
};

/** Everything at one section. Positions outside the element are pulled back onto it. */
export const resultsAt = (element: Beam2D, loadCase: LoadCase, x: number): SectionResult => {
  const length = elementLength(element);
  const at = Math.min(Math.max(x, 0), length);
  const deflection = element.computeLocalDeflAt(loadCase, at);

  return {
    x: at,
    n: element.computeNormalForceAt(loadCase, at),
    vz: element.computeShearForceAt(loadCase, at),
    my: element.computeBendingMomentAt(loadCase, at),
    u: deflection.u,
    w: deflection.w,
    phi: rotationAt(element, loadCase, at, length),
  };
};

/**
 * The element cut into equal pieces, ends included: `divisions + 1` sections.
 *
 * Both ends are always there, which is where the discontinuities live - a support reaction or a
 * point load makes the shear jump, and the pair either side of it is what shows that.
 */
export const resultsAlong = (element: Beam2D, loadCase: LoadCase, divisions: number): SectionResult[] => {
  const steps = Math.max(1, Math.floor(divisions));
  const length = elementLength(element);

  return Array.from({ length: steps + 1 }, (_, i) => resultsAt(element, loadCase, (length * i) / steps));
};

export type SectionQuantity = 'n' | 'vz' | 'my' | 'u' | 'w' | 'phi';

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
