import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { elementLength, extremesOf, resultsAlong, resultsAt } from '@/utils/sectionResults';

/**
 * A simply supported beam under a uniform load, which anyone can check: the moment is a parabola
 * peaking at ql²/8 in the middle, the shear runs linearly from ql/2 to -ql/2 and passes through
 * zero there, and the deflection peaks at 5ql⁴/384EI.
 */
const E = 210e9;
const A = 1e-2;
const I = 1e-5;
const L = 6;
const Q = 2000; // N/m

const near = (actual: number, expected: number, rel = 1e-4) =>
  expect(Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12)).toBeLessThan(rel);

const simplySupported = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
  // a large shear area keeps shear deflection out of the hand calculation
  domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [L, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
  store.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, Q], true);
  store.solve();

  return store;
};

const beam = (store: ReturnType<typeof useProjectStore>) => store.solver.domain.getElement('b') as never;
const lc = (store: ReturnType<typeof useProjectStore>) => store.solver.loadCases[0];

describe('results at a section', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('knows how long the element is', () => {
    near(elementLength(beam(simplySupported())), L);
  });

  it('gives ql²/8 for the moment at midspan', () => {
    const store = simplySupported();

    near(Math.abs(resultsAt(beam(store), lc(store), L / 2).my), (Q * L * L) / 8);
  });

  it('gives ql/2 for the shear at the support, and nothing at midspan', () => {
    const store = simplySupported();
    const start = resultsAt(beam(store), lc(store), 0);
    const middle = resultsAt(beam(store), lc(store), L / 2);

    near(Math.abs(start.vz), (Q * L) / 2);
    expect(Math.abs(middle.vz)).toBeLessThan(1e-6);
  });

  it('gives 5ql⁴/384EI for the deflection at midspan', () => {
    const store = simplySupported();

    near(Math.abs(resultsAt(beam(store), lc(store), L / 2).w), (5 * Q * L ** 4) / (384 * E * I), 1e-3);
  });

  it('leaves the ends free of moment', () => {
    const store = simplySupported();

    expect(Math.abs(resultsAt(beam(store), lc(store), 0).my)).toBeLessThan(1e-6);
    expect(Math.abs(resultsAt(beam(store), lc(store), L).my)).toBeLessThan(1e-6);
  });

  it('pulls a section beyond the element back onto it', () => {
    const store = simplySupported();

    expect(resultsAt(beam(store), lc(store), -3).x).toBe(0);
    expect(resultsAt(beam(store), lc(store), L + 3).x).toBe(L);
  });

  it('reads the parabola, not a straight line between the sampled points', () => {
    const store = simplySupported();
    // at a quarter point the parabola gives 3ql²/32; a chord between end and midspan would give half
    // of ql²/8, which is ql²/16 - so this distinguishes the two
    near(Math.abs(resultsAt(beam(store), lc(store), L / 4).my), (3 * Q * L * L) / 32);
  });
});

describe('results along the element', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('cuts it into equal pieces, ends included', () => {
    const store = simplySupported();
    const sections = resultsAlong(beam(store), lc(store), 6);

    expect(sections).toHaveLength(7);
    expect(sections[0].x).toBe(0);
    near(sections[6].x, L);
    near(sections[3].x, L / 2);
  });

  it('never asks for fewer than one piece', () => {
    const store = simplySupported();

    expect(resultsAlong(beam(store), lc(store), 0)).toHaveLength(2);
    expect(resultsAlong(beam(store), lc(store), -5)).toHaveLength(2);
  });

  it('marks the largest value on show, per quantity', () => {
    const store = simplySupported();
    const sections = resultsAlong(beam(store), lc(store), 6);
    const extremes = extremesOf(sections);

    // the moment and the deflection peak in the middle, the shear at an end
    expect(sections[extremes.my].x).toBeCloseTo(L / 2, 6);
    expect(sections[extremes.w].x).toBeCloseTo(L / 2, 6);
    expect([0, L]).toContain(sections[extremes.vz].x);
  });

  it('marks nothing for a quantity that is zero throughout', () => {
    const store = simplySupported();
    const extremes = extremesOf(resultsAlong(beam(store), lc(store), 4));

    // no axial load on this beam
    expect(extremes.n).toBe(-1);
  });
});

describe('the rotation', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('gives ql³/24EI at the ends, equal and opposite', () => {
    const store = simplySupported();
    const start = resultsAt(beam(store), lc(store), 0);
    const end = resultsAt(beam(store), lc(store), L);

    near(Math.abs(start.phi), (Q * L ** 3) / (24 * E * I), 1e-3);
    near(start.phi, -end.phi, 1e-3);
  });

  it('vanishes at midspan, where the deflection peaks', () => {
    const store = simplySupported();

    expect(Math.abs(resultsAt(beam(store), lc(store), L / 2).phi)).toBeLessThan(1e-9);
  });

  /**
   * The one quantity that is differenced rather than read from the library, so it is held against
   * the rotations the solver itself found - which the element carries at its ends.
   */
  it('agrees at the ends with the rotation the solver found', () => {
    const store = simplySupported();
    const element = beam(store) as unknown as {
      computeEndDisplacement: (lc: unknown) => { get: (i: number[]) => number };
    };
    const ends = element.computeEndDisplacement(lc(store));

    near(resultsAt(beam(store), lc(store), 0).phi, ends.get([2]), 1e-5);
    near(resultsAt(beam(store), lc(store), L).phi, ends.get([5]), 1e-5);
  });
});
