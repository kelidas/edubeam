import { describe, it, expect } from 'vitest';
import { smoothPath } from '@/utils/smoothPath';
import { samplesAlong, stepsBetween } from '@/utils/elementSampling';

/** Every curve of a path, each as the x of where it starts, its two control points and its end. */
const curvesOf = (path: string) => {
  const curves: number[][] = [];
  let at = 0;

  for (const [, command, args] of path.matchAll(/([MLC])\s*([^MLC]*)/g)) {
    const xs = args
      .trim()
      .split(/\s+/)
      .map((p) => Number(p.split(',')[0]));

    if (command === 'C') curves.push([at, ...xs]);
    at = xs.at(-1)!;
  }

  return curves;
};

/** A curve whose control points stay between its ends moves only forward along x - no loop. */
const forwardOnly = (curve: number[]) => {
  const [from, c1, c2, to] = curve;

  return [c1, c2].every((c) => c >= Math.min(from, to) - 1e-12 && c <= Math.max(from, to) + 1e-12);
};

/** A deflected shape sampled the way the drawing samples one with a point load in the middle. */
const sagging = () => {
  const xs = samplesAlong(4, [2]);
  const points = xs.map((x): [number, number] => [x, 0.1 * Math.sin((Math.PI * x) / 4)]);

  return { xs, points };
};

describe('a smooth path through a deflected shape', () => {
  it('cuts it where two samples are a hair either side of a load', () => {
    const { xs } = sagging();
    const cuts = stepsBetween(xs);

    expect(cuts).toHaveLength(1);
    expect(xs[cuts[0]]).toBeLessThan(2);
    expect(xs[cuts[0] + 1]).toBeGreaterThan(2);
  });

  it('draws no loop there', () => {
    const { xs, points } = sagging();
    const curves = curvesOf(smoothPath(points, stepsBetween(xs)));

    expect(curves.length).toBe(points.length - 2);
    curves.forEach((curve, i) => expect(forwardOnly(curve), `curve ${i}`).toBe(true));
  });

  it('is unchanged where nothing cuts it', () => {
    const points: [number, number][] = [0, 1, 2, 3, 4].map((x) => [x, x * x]);

    expect(smoothPath(points, [])).toBe(smoothPath(points));
    expect(curvesOf(smoothPath(points))).toHaveLength(4);
  });
});
