import { describe, it, expect } from 'vitest';
import { Beam2D, DofID, LinearStaticSolver } from 'ts-fem';
import {
  chainJumpsOf,
  chainOf,
  chainResultsAlong,
  chainResultsAt,
  chainStationaryPoints,
  collinearRun,
} from '@/utils/sectionChain';

/**
 * A continuous beam over three supports, 4 m and 6 m spans, under a uniform load and a point load
 * on the second span. `reversed` models the second span from its far end, with the same loads
 * given so they push the same way - the chain has to read the two models identically.
 */
const continuous = (reversed = false, hinge = false) => {
  const solver = new LinearStaticSolver();
  const { domain } = solver;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e32 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [4, 0, 0], [DofID.Dz]);
  domain.createNode('3', [10, 0, 0], [DofID.Dz]);
  domain.createBeam2D('a', ['1', '2'], 'm', 'cs', [false, hinge]);
  domain.createBeam2D('b', reversed ? ['3', '2'] : ['2', '3'], 'm', 'cs');

  const lc = solver.loadCases[0];
  lc.createBeamElementUniformEdgeLoad('a', [0, 1000], false);
  lc.createBeamElementUniformEdgeLoad('b', [0, 1000], false);
  // 2 m into the second span from node 2, measured from whichever node the element starts at
  lc.createBeamConcentratedLoad('b', [0, 3000, 0, reversed ? 4 : 2], false);
  solver.solve();

  const element = (label: string) => domain.elements.get(label) as Beam2D;

  return { solver, lc, a: element('a'), b: element('b') };
};

describe('a chain of elements', () => {
  it('orders the spans left to right and marks one modelled the other way', () => {
    const { a, b } = continuous(true);
    const chain = chainOf([b, a])!;

    expect(chain.parts.map((p) => [p.element.label, p.reversed, p.offset])).toEqual([
      ['a', false, 0],
      ['b', true, 4],
    ]);
    expect(chain.length).toBeCloseTo(10, 12);
    expect(chain.nodes.map((n) => [n.label, n.x])).toEqual([
      ['1', 0],
      ['2', 4],
      ['3', 10],
    ]);
  });

  it('keeps the way the element it started from points, so that one reads as it did alone', () => {
    const { a, b } = continuous(true);

    const alone = chainOf([b], b)!;
    expect(alone.parts[0].reversed).toBe(false);
    expect(alone.nodes.map((n) => n.label)).toEqual(['3', '2']);

    const whole = chainOf([a, b], b)!;
    expect(whole.parts.map((p) => [p.element.label, p.reversed])).toEqual([
      ['b', false],
      ['a', true],
    ]);
  });

  it('refuses elements that are not one straight line', () => {
    const { solver, a } = continuous();
    solver.domain.createNode('4', [4, 0, -3], []);
    const column = solver.domain.createBeam2D('c', ['2', '4'], 'm', 'cs') as Beam2D;

    expect(chainOf([a, column])).toBeNull();
  });

  it('finds the whole continuous beam from one span, passing over a column at a support', () => {
    const { solver, a, b } = continuous();
    solver.domain.createNode('4', [4, 0, -3], []);
    solver.domain.createBeam2D('c', ['2', '4'], 'm', 'cs');

    expect(new Set(collinearRun(solver, b))).toEqual(new Set([a, b]));
  });

  /** The test that holds the signs: the same beam, modelled two ways, read the same. */
  it('reads a span modelled the other way round exactly as one modelled forward', () => {
    const forward = continuous(false);
    const backward = continuous(true);

    const one = chainResultsAlong(chainOf([forward.a, forward.b])!, forward.lc, 20);
    const two = chainResultsAlong(chainOf([backward.a, backward.b])!, backward.lc, 20);

    expect(two.map((s) => [s.x, s.side])).toEqual(one.map((s) => [s.x, s.side]));

    for (const q of ['n', 'vz', 'my', 'u', 'w', 'phi'] as const) {
      const size = Math.max(...one.map((s) => Math.abs(s[q])), 1e-30);
      one.forEach((s, i) => expect(Math.abs(two[i][q] - s[q]) / size).toBeLessThan(1e-9));
    }
  });

  it('reads the shear either side of the middle support, where it steps, and the moment once', () => {
    const { lc, a, b } = continuous();
    const chain = chainOf([a, b])!;

    expect(chainJumpsOf(chain, lc, 'vz')).toContain(4);
    expect(chainJumpsOf(chain, lc, 'my')).not.toContain(4);

    const atSupport = chainResultsAlong(chain, lc, 10).filter((s) => Math.abs(s.x - 4) < 1e-9);
    expect(atSupport.map((s) => s.side)).toEqual([-1, 1]);
    expect(atSupport[0].my).toBeCloseTo(atSupport[1].my, 6);
    expect(atSupport[0].vz).not.toBeCloseTo(atSupport[1].vz, 0);
  });

  it('sees the rotation step at a hinge where the spans meet', () => {
    const { lc, a, b } = continuous(false, true);
    const chain = chainOf([a, b])!;

    expect(chainJumpsOf(chain, lc, 'phi')).toContain(4);
    expect(chainResultsAt(chain, lc, 4, -1).my).toBeCloseTo(0, 6);
  });

  it('finds the moment peaking inside each span, as distances along the whole beam', () => {
    const { lc, a, b } = continuous(true);
    const peaks = chainStationaryPoints(chainOf([a, b])!, lc, 'my');

    expect(peaks.length).toBeGreaterThanOrEqual(2);
    expect(peaks.some((x) => x > 0 && x < 4)).toBe(true);
    expect(peaks.some((x) => x > 4 && x < 10)).toBe(true);
  });
});
