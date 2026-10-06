import { describe, it, expect } from 'vitest';
import { deflectionSamples } from '@/utils/deflectionSamples';

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

describe('where a deflected shape is drawn from', () => {
  it('cuts a plain element into equal pieces, ends included', () => {
    const xs = deflectionSamples(8, []);

    expect(xs).toHaveLength(17);
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(8);
    expect(increasing(xs)).toBe(true);
  });

  /** The case a student saw as a straight line: the step inside the first of sixteen pieces. */
  it('gives a short stretch beside a support points of its own', () => {
    const xs = deflectionSamples(8, [0.3]);
    const before = xs.filter((x) => x < 0.3);

    expect(before.length).toBeGreaterThanOrEqual(7);
    expect(increasing(xs)).toBe(true);
  });

  it('reads either side of a step, a hair from it', () => {
    const xs = deflectionSamples(8, [3]);

    expect(xs.some((x) => x < 3 && 3 - x < 1e-6)).toBe(true);
    expect(xs.some((x) => x > 3 && x - 3 < 1e-6)).toBe(true);
  });

  it('keeps the node and the opened section apart for a step at an end', () => {
    const xs = deflectionSamples(8, [0, 8]);

    expect(xs.slice(0, 2)).toEqual([0, 1e-7]);
    expect(xs.at(-1)).toBe(8);
    expect(8 - xs.at(-2)!).toBeCloseTo(1e-7, 12);
    expect(increasing(xs)).toBe(true);
  });
});
