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
}

export const elementLength = (element: Beam2D) => element.computeGeo().l;

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

export type SectionQuantity = 'n' | 'vz' | 'my' | 'u' | 'w';

/**
 * Where each quantity reaches furthest from zero, by index into the sections given.
 *
 * Read off the same sections the table shows rather than solved for: a true extreme sits wherever
 * the derivative vanishes, which no finite set of sections is bound to contain. It marks the
 * largest value *on show*, which is what someone comparing rows is looking for - so the marking
 * gets finer as the divisions do, and never claims more than the table can support.
 */
export const extremesOf = (sections: SectionResult[]): Record<SectionQuantity, number> => {
  const quantities: SectionQuantity[] = ['n', 'vz', 'my', 'u', 'w'];
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
