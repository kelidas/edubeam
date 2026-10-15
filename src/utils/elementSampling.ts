import {
  BeamConcentratedDeformation,
  BeamConcentratedLoad,
  BeamElementTrapezoidalEdgeLoad,
  type Beam2D,
  type LoadCase,
} from 'ts-fem';

/** How far either side of a step its two values are read. */
const EITHER_SIDE = 1e-7;

/**
 * Every place along an element, in metres from its start, where something drawn along it can step,
 * kink or change the curve it follows: a point force or moment, an imposed deformation, and either
 * end of a trapezoidal load that covers only part of the element.
 *
 * Which of the diagrams actually breaks there differs - a point moment steps the bending moment and
 * kinks the rotation, a partial load kinks the shear - but reading every diagram either side of all
 * of them costs a few points and means none has to know which loads concern it.
 */
export const elementBreaks = (element: Beam2D, loadCase: LoadCase): number[] =>
  loadCase.getElementLoadsOnElement(element.label).flatMap((load) => {
    if (load instanceof BeamConcentratedLoad || load instanceof BeamConcentratedDeformation) return [load.values[3]];
    if (load instanceof BeamElementTrapezoidalEdgeLoad)
      return [load.from, load.to].filter((x): x is number => x !== undefined);

    return [];
  });

/**
 * Where along an element a quantity is evaluated for drawing, in metres from its start.
 *
 * Between the element's ends and its breaks a quantity follows one smooth curve; at each break it
 * may step or kink. Each stretch between them is sampled on its own - by its share of `count`, but
 * never by fewer than `least` pieces - so a short stretch beside a support keeps its curve instead
 * of being drawn as one straight line from the end to the break. Either side of a break a point is
 * taken a hair from it, which is where the two values of a step are.
 */
export const samplesAlong = (length: number, steps: number[], count = 16, least = 6): number[] => {
  const atStart = steps.some((d) => d <= EITHER_SIDE);
  const atEnd = steps.some((d) => d >= length - EITHER_SIDE);
  const inside = [...new Set(steps.filter((d) => d > EITHER_SIDE && d < length - EITHER_SIDE))].sort((a, b) => a - b);

  const bounds = [0, ...inside, length];
  const xs: number[] = atStart ? [0] : [];

  for (let i = 0; i < bounds.length - 1; i++) {
    const first = i === 0;
    const last = i === bounds.length - 2;
    const from = bounds[i] + (!first || atStart ? EITHER_SIDE : 0);
    const to = bounds[i + 1] - (!last || atEnd ? EITHER_SIDE : 0);
    const pieces = Math.max(least, Math.ceil((count * (to - from)) / length));

    for (let k = 0; k <= pieces; k++) xs.push(from + ((to - from) * k) / pieces);
  }

  if (atEnd) xs.push(length);

  return xs;
};

/**
 * The indices after which two samples straddle a break, a hair either side of it - where a path
 * through the samples is better cut than carried across, since what is either side of a step is
 * not one curve.
 */
export const stepsBetween = (xs: number[]): number[] =>
  xs.flatMap((x, i) => (i < xs.length - 1 && xs[i + 1] - x <= 3 * EITHER_SIDE ? [i] : []));
