import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import {
  discontinuities,
  elementLength,
  jumpsOf,
  extremesOf,
  resultsAlong,
  resultsAt,
  stationaryPoints,
} from '@/utils/sectionResults';

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

/** The bare beam, with whatever is applied at a point put on it by the caller. */
const withPointValues = (values: number[], deformation = false) => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [L, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');

  if (deformation) {
    store.solver.loadCases[0].createBeamConcentratedDeformation('b', values, true);
  } else {
    store.solver.loadCases[0].createBeamConcentratedLoad('b', values, true);
  }

  store.solve();

  return store;
};

/** A single transverse force, whose moment peaks under the load wherever it is put. */
const withPointLoad = (at: number) => withPointValues([0, 5000, 0, at]);
const withPointMoment = (at: number, my: number) => withPointValues([0, 0, my, at]);
const withAxialLoad = (at: number, fx: number) => withPointValues([fx, 0, 0, at]);
const withDislocation = (at: number, w: number) => withPointValues([0, w, 0, at], true);

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

/**
 * The peak of a moment almost never falls on a regular division, and it is usually the one place
 * on the beam anyone wants a number from - so it is solved for, against the relation between the
 * moment and the shear, rather than picked out of the sections on show.
 */
describe('where a quantity turns', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('puts the moment’s peak at midspan under a uniform load', () => {
    const store = simplySupported();
    const turns = stationaryPoints(beam(store), lc(store), 'my');

    expect(turns).toHaveLength(1);
    near(turns[0], L / 2, 1e-6);
  });

  it('finds it to far better than the sections could', () => {
    const store = simplySupported();
    const [peak] = stationaryPoints(beam(store), lc(store), 'my');

    // eight divisions of this beam land every 0.75 m; the root is exact to a nanometre
    expect(Math.abs(peak - L / 2)).toBeLessThan(1e-9);
    near(Math.abs(resultsAt(beam(store), lc(store), peak).my), (Q * L * L) / 8);
  });

  it('puts the deflection’s peak there too, where the rotation passes through zero', () => {
    const store = simplySupported();
    const turns = stationaryPoints(beam(store), lc(store), 'w');

    expect(turns).toHaveLength(1);
    near(turns[0], L / 2, 1e-5);
  });

  it('follows the load rather than the middle', () => {
    const store = withPointLoad(1.5);
    const turns = stationaryPoints(beam(store), lc(store), 'my');

    // under a single point load the moment peaks at the load, wherever it is put
    expect(turns).toHaveLength(1);
    near(turns[0], 1.5, 1e-3);
  });

  it('says nothing about a quantity whose slope is the load itself', () => {
    const store = simplySupported();

    // the shear steps with the load and jumps at a point load; it does not turn in between
    expect(stationaryPoints(beam(store), lc(store), 'vz')).toEqual([]);
    expect(stationaryPoints(beam(store), lc(store), 'n')).toEqual([]);
  });

  it('passes over a stretch that is flat rather than calling all of it a peak', () => {
    const store = useProjectStore();
    const domain = store.solver.domain;

    domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
    domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
    domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    domain.createNode('2', [L, 0, 0], [DofID.Dz]);
    domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
    store.solve();

    // nothing on the beam at all: the moment is zero everywhere, so no point of it is the peak
    expect(stationaryPoints(beam(store), lc(store), 'my')).toEqual([]);
  });
});

/**
 * Everything applied at a point leaves the results with two values at its own distance and none
 * exactly at it, so the table has to carry both - a shear of ql/2 on one side and ql/2 - F on the
 * other is the whole content of a point load.
 */
describe('either side of a jump', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const F = 5000;

  it('finds the load’s distance', () => {
    const store = withPointLoad(2);

    expect(discontinuities(beam(store), lc(store))).toEqual([2]);
  });

  it('reports nothing to jump at when the load is spread', () => {
    const store = simplySupported();

    expect(discontinuities(beam(store), lc(store))).toEqual([]);
  });

  it('gives two sections there, marked which side they are', () => {
    const store = withPointLoad(2);
    const sections = resultsAlong(beam(store), lc(store), 4);
    const atJump = sections.filter((section) => section.side !== undefined);

    expect(atJump).toHaveLength(2);
    expect(atJump[0].side).toBe(-1);
    expect(atJump[1].side).toBe(1);
    expect(atJump[0].x).toBeLessThan(atJump[1].x);
  });

  it('shows the shear stepping by the whole force across it', () => {
    const store = withPointLoad(2);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    expect(Math.abs(before.vz - after.vz)).toBeCloseTo(F, 3);
  });

  it('keeps the moment together across a force, which does not jump', () => {
    const store = withPointLoad(2);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    // a force breaks the slope of the moment, not the moment
    expect(before.my).toBeCloseTo(after.my, 3);
  });

  it('shows the moment stepping across a concentrated moment', () => {
    const store = withPointMoment(2, 4000);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    expect(Math.abs(before.my - after.my)).toBeCloseTo(4000, 2);
  });

  it('shows the normal force stepping across an axial load', () => {
    const store = withAxialLoad(2, 3000);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    expect(Math.abs(before.n - after.n)).toBeCloseTo(3000, 2);
  });

  it('shows the deflection stepping across a concentrated deformation', () => {
    const store = withDislocation(2, 0.01);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    expect(Math.abs(before.w - after.w)).toBeCloseTo(0.01, 6);
  });

  it('drops a division that lands on the jump, which has no value of its own', () => {
    const store = withPointLoad(1.5);
    const sections = resultsAlong(beam(store), lc(store), 4);

    // four pieces of a six metre beam land at 1.5, exactly where the load is
    expect(sections.filter((s) => Math.abs(s.x - 1.5) < 1e-6 && s.side === undefined)).toHaveLength(0);
    expect(sections.filter((s) => s.side !== undefined)).toHaveLength(2);
  });

  it('keeps every section in order along the element', () => {
    const store = withPointLoad(2);
    const sections = resultsAlong(beam(store), lc(store), 4);

    for (let i = 1; i < sections.length; i++) {
      expect(sections[i].x).toBeGreaterThanOrEqual(sections[i - 1].x);
    }
  });

  it('leaves a load sitting on an end alone, where there is no "either side"', () => {
    const store = withPointLoad(0);

    expect(discontinuities(beam(store), lc(store))).toEqual([]);
  });
});

/**
 * The rotation is differenced from the deflection curve, and that curve is only a curve between the
 * discontinuities. A difference taken across one is not a slope of anything.
 */
describe('the rotation at a jump', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const DISLOCATION = 0.01;

  it('stays a rotation across a concentrated deformation', () => {
    const store = withDislocation(2, DISLOCATION);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    /*
     * A difference straddling the jump returns it divided by the step - with the step at 1e-4 of a
     * six metre beam that is about 8 radians, for a beam that turns by a thousandth of one.
     */
    expect(Math.abs(before.phi)).toBeLessThan(0.05);
    expect(Math.abs(after.phi)).toBeLessThan(0.05);
  });

  it('agrees with the slope a little further along the same side', () => {
    const store = withDislocation(2, DISLOCATION);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    // the slope does not change abruptly in the last millimetres before the jump
    expect(before.phi).toBeCloseTo(resultsAt(beam(store), lc(store), 1.99).phi, 4);
    expect(after.phi).toBeCloseTo(resultsAt(beam(store), lc(store), 2.01).phi, 4);
  });

  it('leaves the rotation whole across a concentrated moment', () => {
    const store = withPointMoment(2, 4000);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    // a moment steps the curvature, which is the slope of the rotation, not the rotation itself
    expect(before.phi).toBeCloseTo(after.phi, 6);
    expect(Math.abs(before.my - after.my)).toBeCloseTo(4000, 2);
  });

  it('still gives the solver’s own end rotations with a jump on the beam', () => {
    const store = withPointLoad(2);
    const element = beam(store) as unknown as {
      computeEndDisplacement: (lc: unknown) => { get: (i: number[]) => number };
    };
    const ends = element.computeEndDisplacement(lc(store));

    near(resultsAt(beam(store), lc(store), 0).phi, ends.get([2]), 1e-5);
    near(resultsAt(beam(store), lc(store), L).phi, ends.get([5]), 1e-5);
  });

  it('does not leave the deflection’s own jump behind', () => {
    const store = withDislocation(2, DISLOCATION);
    const [before, after] = resultsAlong(beam(store), lc(store), 4).filter((s) => s.side !== undefined);

    // the deflection still steps by the whole dislocation; only the rotation changed
    expect(Math.abs(before.w - after.w)).toBeCloseTo(DISLOCATION, 6);
  });
});

/**
 * Nothing applied at a point steps everything. A force steps the shear and leaves the deflection
 * whole; an imposed deformation steps the deflection and leaves the internal forces whole, which is
 * what makes it the tool for drawing an influence line.
 */
describe('which quantities a point load steps', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const stepped = (store: ReturnType<typeof useProjectStore>) =>
    (['n', 'vz', 'my', 'u', 'w', 'phi'] as const).filter((q) => jumpsOf(beam(store), lc(store), q).length > 0);

  it('steps the shear under a transverse force, and nothing else', () => {
    expect(stepped(withPointLoad(2))).toEqual(['vz']);
  });

  it('steps the normal force under an axial one', () => {
    expect(stepped(withAxialLoad(2, 3000))).toEqual(['n']);
  });

  it('steps the moment under a concentrated moment', () => {
    expect(stepped(withPointMoment(2, 4000))).toEqual(['my']);
  });

  it('steps the deflection under an imposed deformation, and no internal force', () => {
    expect(stepped(withDislocation(2, 0.01))).toEqual(['w']);
  });

  it('still reads a section either side of any of them', () => {
    const store = withDislocation(2, 0.01);

    // the table pairs sections wherever anything steps; which columns differ is another question
    expect(discontinuities(beam(store), lc(store))).toEqual([2]);
  });

  it('sees both when a load in global axes crosses a sloping element', () => {
    const store = useProjectStore();
    const domain = store.solver.domain;

    domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
    domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
    domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    domain.createNode('2', [4, 0, 3], [DofID.Dz]);
    domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
    // straight down in global axes, which on this beam is partly along it and partly across
    store.solver.loadCases[0].createBeamConcentratedLoad('b', [0, 5000, 0, 2], false);
    store.solve();

    expect(stepped(store)).toEqual(['n', 'vz']);
  });
});

describe('a turning point where the quantity steps', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('is not reported for a deflection with a dislocation in it', () => {
    const store = withDislocation(2, 0.01);

    /*
     * The deflection has two values there and no slope between them. A difference taken across the
     * step crosses zero for reasons of its own, and calling that a peak would put a third number on
     * the one place that already has two.
     */
    expect(stationaryPoints(beam(store), lc(store), 'w').filter((x) => Math.abs(x - 2) < 1e-3)).toEqual([]);
  });

  it('is still reported for a moment under a point load, which does peak there', () => {
    const store = withPointLoad(2);

    // the shear steps through zero at the load: the moment is continuous and its peak is real
    const [peak] = stationaryPoints(beam(store), lc(store), 'my');

    near(peak, 2, 1e-3);
  });

  it('is not reported for a moment at a concentrated moment, which steps', () => {
    const store = withPointMoment(2, 4000);

    expect(stationaryPoints(beam(store), lc(store), 'my').filter((x) => Math.abs(x - 2) < 1e-3)).toEqual([]);
  });
});
