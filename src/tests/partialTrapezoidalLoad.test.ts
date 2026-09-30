import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { BeamElementTrapezoidalEdgeLoad, DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { serializeModel, deserializeModel } from '@/utils/serializeModel';

/**
 * A trapezoidal load given a position covers that part of its element.
 *
 * The arithmetic is the solver's; what the app has to get right is that the position travels with
 * the model, and that a load without one is saved exactly as it always was - that string is what a
 * shared link carries.
 */
const build = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [6, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');

  return store;
};

const reopened = (store: ReturnType<typeof useProjectStore>) => {
  const saved = serializeModel(store.solver, store.dimensions);

  setActivePinia(createPinia());
  const fresh = useProjectStore();

  deserializeModel(saved, fresh.solver, fresh.dimensions);

  return fresh.solver.loadCases[0];
};

describe('a trapezoidal load over part of an element', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('covers the whole element when it is given no position', () => {
    const store = build();
    const load = store.solver.loadCases[0].createBeamElementTrapezoidalEdgeLoad('b', [0, 1000], [0, 2000], true);

    expect(load.from).toBeUndefined();
    expect(load.to).toBeUndefined();
    expect(load.partial()).toBe(false);
  });

  it('is saved and read back with the position it was given', () => {
    const store = build();

    store.solver.loadCases[0].createBeamElementTrapezoidalEdgeLoad('b', [0, 800], [0, 2000], true, 1.5, 4.5);

    const read = reopened(store).elementLoadList[0] as BeamElementTrapezoidalEdgeLoad;

    expect(read.from).toBeCloseTo(1.5, 9);
    expect(read.to).toBeCloseTo(4.5, 9);
    expect(read.partial()).toBe(true);
  });

  it('adds nothing to the saved model while it covers its element', () => {
    const store = build();
    const load = store.solver.loadCases[0].createBeamElementTrapezoidalEdgeLoad('b', [0, 800], [0, 2000], true);

    const plain = serializeModel(store.solver, store.dimensions);

    load.from = 1;
    load.to = 5;

    expect(serializeModel(store.solver, store.dimensions)).not.toBe(plain);

    load.from = undefined;
    load.to = undefined;

    expect(serializeModel(store.solver, store.dimensions)).toBe(plain);
  });

  /** The results follow the position, which is what makes the whole thing worth having. */
  it('carries less of the beam than the same load over the whole of it', () => {
    const store = build();
    const load = store.solver.loadCases[0].createBeamElementTrapezoidalEdgeLoad('b', [0, 1000], [0, 1000], true);

    store.solver.solve();
    const whole = store.solver.domain.getNode('1').getReactions(store.solver.loadCases[0]).values.get([1]);

    load.from = 2;
    load.to = 4;
    store.solver.codeNumberGenerated = false;
    store.solver.solve();
    const part = store.solver.domain.getNode('1').getReactions(store.solver.loadCases[0]).values.get([1]);

    // a third of the length, so a third of the load - and it sits at midspan, so half of it here
    expect(Math.abs(part)).toBeCloseTo(Math.abs(whole) / 3, 6);
  });
});
