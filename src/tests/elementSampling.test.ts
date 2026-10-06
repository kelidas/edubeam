import { describe, it, expect } from 'vitest';
import { DofID, LinearStaticSolver } from 'ts-fem';
import { elementBreaks, samplesAlong } from '@/utils/elementSampling';

const increasing = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

describe('where a quantity along an element is drawn from', () => {
  it('cuts a plain element into equal pieces, ends included', () => {
    const xs = samplesAlong(8, []);

    expect(xs).toHaveLength(17);
    expect(xs[0]).toBe(0);
    expect(xs.at(-1)).toBe(8);
    expect(increasing(xs)).toBe(true);
  });

  /** The case a student saw as a straight line: the step inside the first of sixteen pieces. */
  it('gives a short stretch beside a support points of its own', () => {
    const xs = samplesAlong(8, [0.3]);
    const before = xs.filter((x) => x < 0.3);

    expect(before.length).toBeGreaterThanOrEqual(7);
    expect(increasing(xs)).toBe(true);
  });

  it('reads either side of a step, a hair from it', () => {
    const xs = samplesAlong(8, [3]);

    expect(xs.some((x) => x < 3 && 3 - x < 1e-6)).toBe(true);
    expect(xs.some((x) => x > 3 && x - 3 < 1e-6)).toBe(true);
  });

  it('keeps the node and the opened section apart for a step at an end', () => {
    const xs = samplesAlong(8, [0, 8]);

    expect(xs.slice(0, 2)).toEqual([0, 1e-7]);
    expect(xs.at(-1)).toBe(8);
    expect(8 - xs.at(-2)!).toBeCloseTo(1e-7, 12);
    expect(increasing(xs)).toBe(true);
  });
});

describe('where an element can break', () => {
  it('lists point loads, imposed deformations and the ends of a partial load, and nothing else', () => {
    const solver = new LinearStaticSolver();
    solver.domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
    solver.domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e32 });
    solver.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    solver.domain.createNode('2', [8, 0, 0], [DofID.Dz]);
    const element = solver.domain.createBeam2D('a', ['1', '2'], 'm', 'cs');
    const lc = solver.loadCases[0];

    lc.createBeamElementUniformEdgeLoad('a', [0, 1000], true);
    lc.createBeamConcentratedLoad('a', [0, 0, 5000, 0.4], true);
    lc.createBeamConcentratedDeformation('a', [0, 0, 1, 6], true);
    lc.createBeamElementTrapezoidalEdgeLoad('a', [0, 1000], [0, 2000], true, 2, 3);
    lc.createBeamElementTrapezoidalEdgeLoad('a', [0, 1000], [0, 2000], true);
    lc.createBeamTemperatureLoad('a', [10, 5, 0]);

    expect(elementBreaks(element, lc).sort((x, y) => x - y)).toEqual([0.4, 2, 3, 6]);
  });
});
