import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { serializeModel, deserializeModel } from '@/utils/serializeModel';
import { buildResultsCsv, switchedOffLoads } from '@/utils/exportResults';

/**
 * A load switched off, and a load with a name.
 *
 * Both belong to the model, so both have to survive being saved and read back - and a model where
 * every load is on and unnamed has to serialise to exactly what it did before, because that string
 * is what a shared link carries.
 */
const build = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [4, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');

  return store;
};

/** Saved, and read back into a store that has never seen the model. */
const reopened = (store: ReturnType<typeof useProjectStore>) => {
  const saved = serializeModel(store.solver, store.dimensions);

  setActivePinia(createPinia());
  const fresh = useProjectStore();

  deserializeModel(saved, fresh.solver, fresh.dimensions);

  return fresh.solver.loadCases[0];
};

describe('a load that is switched off or named', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts switched on and nameless', () => {
    const store = build();
    const load = store.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, 1000], true);

    expect(load.active).toBe(true);
    expect(load.label).toBe('');
  });

  it('is saved and read back for every kind of load', () => {
    const store = build();
    const lc = store.solver.loadCases[0];

    const udl = lc.createBeamElementUniformEdgeLoad('b', [0, 1000], true);
    const point = lc.createBeamConcentratedLoad('b', [0, 500, 0, 2], true);
    const nodal = lc.createNodalLoad('2', { [DofID.Dz]: 300 });
    const prescribed = lc.createPrescribedDisplacement('1', { [DofID.Dz]: 0.01 });

    udl.active = false;
    udl.label = 'snow';
    point.label = 'crane';
    nodal.active = false;
    prescribed.label = 'settlement';

    const read = reopened(store);

    expect(read.elementLoadList[0].active).toBe(false);
    expect(read.elementLoadList[0].label).toBe('snow');
    expect(read.elementLoadList[1].active).toBe(true);
    expect(read.elementLoadList[1].label).toBe('crane');
    expect(read.nodalLoadList[0].active).toBe(false);
    expect(read.prescribedBC[0].label).toBe('settlement');
  });

  /** The link of a model nobody has touched this way must not change. */
  it('adds nothing to the saved model while every load is on and unnamed', () => {
    const store = build();
    const lc = store.solver.loadCases[0];

    lc.createBeamElementUniformEdgeLoad('b', [0, 1000], true);
    lc.createNodalLoad('2', { [DofID.Dz]: 300 });

    const plain = serializeModel(store.solver, store.dimensions);

    lc.elementLoadList[0].label = 'snow';
    const named = serializeModel(store.solver, store.dimensions);

    expect(named).not.toBe(plain);

    lc.elementLoadList[0].label = '';
    expect(serializeModel(store.solver, store.dimensions)).toBe(plain);
  });

  it('reads a model from before there was anything to read', () => {
    const store = build();
    const lc = store.solver.loadCases[0];

    lc.createBeamElementUniformEdgeLoad('b', [0, 1000], true);

    const read = reopened(store);

    expect(read.elementLoadList[0].active).toBe(true);
    expect(read.elementLoadList[0].label).toBe('');
  });

  /** A table read a week later should say what it was worked out without. */
  it('says in the exported results which loads were switched off', () => {
    const store = build();
    const lc = store.solver.loadCases[0];

    const udl = lc.createBeamElementUniformEdgeLoad('b', [0, 1000], true);
    lc.createNodalLoad('2', { [DofID.Dz]: 300 });

    expect(switchedOffLoads(store.solver)).toEqual([]);

    udl.active = false;
    udl.label = 'snow';

    expect(switchedOffLoads(store.solver)).toEqual(['snow']);

    const units = {
      lengthLabel: 'm',
      angleLabel: 'rad',
      forceLabel: 'kN',
      momentLabel: 'kNm',
      length: (v: number) => v,
      force: (v: number) => v,
      moment: (v: number) => v,
    };

    // the tables themselves are read off a solved model
    store.solver.solve();

    expect(buildResultsCsv(store.solver, units)).toContain('snow');
  });
});
