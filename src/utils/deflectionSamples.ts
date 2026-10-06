/** How far either side of a step its two values are read. */
const EITHER_SIDE = 1e-7;

/**
 * Where along an element its deflected shape is evaluated for drawing, in metres from its start.
 *
 * The shape is smooth between the element's ends and the sections an imposed deformation opens it
 * at, and steps or kinks at each of those. Each stretch between them is sampled on its own - by its
 * share of `count`, but never by fewer than `least` pieces - so a short stretch beside a support
 * keeps its curve instead of being drawn as the one straight line between the end and the step.
 * Either side of a step a point is taken a hair from it, which is where its two values are.
 */
export const deflectionSamples = (length: number, steps: number[], count = 16, least = 6): number[] => {
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
