import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { changeLabel } from '@/utils';
import {
  assembleFrom,
  elementDofNames,
  ELEMENT_DOFS,
  nodalLoadVector,
  occupied,
  only,
  rightHandSide,
  solutionVector,
  structureDofNames,
  endForcesGlobal,
  endForcesLocal,
  globalStiffness,
  localStiffness,
  systemStiffness,
  transformation,
} from '@/utils/elementMatrices';

/**
 * These are read, not solved with, so they are checked against results anyone can work out by hand:
 * a clamped beam under a uniform load carries ql²/12 at each end and ql/2 of shear, and releasing
 * one end moves that to ql²/8 at the other.
 *
 * The point of the primary/secondary split is that it adds up - `computeEndForces` reports the sum,
 * so the two halves are a check on each other rather than two separate readings.
 */
const E = 210e9;
const A = 1e-2;
const I = 1e-5;
const L = 4;
const Q = 1000; // N/m

/**
 * Relative, because these numbers span orders of magnitude - 4EI/L is 2.1e6 - and the shear term
 * the library carries never quite vanishes however large the shear area is made.
 */
const near = (actual: number, expected: number, rel = 1e-6) =>
  expect(Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-12)).toBeLessThan(rel);

const build = (hinges: [boolean, boolean] = [false, false]) => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
  // a huge shear area keeps the shear flexibility out of the hand calculation
  domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
  domain.createNode('2', [L, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs', hinges);

  return store;
};

const beam = (store: ReturnType<typeof useProjectStore>) => store.solver.domain.getElement('b') as never;

describe('the element matrices', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('names six degrees of freedom, in the order the matrices use', () => {
    expect(ELEMENT_DOFS).toHaveLength(6);
  });

  it('gives a 6x6 local stiffness matrix', () => {
    const k = localStiffness(beam(build()), false);

    expect(k).toHaveLength(6);
    expect(k[0]).toHaveLength(6);
  });

  it('puts EA/L in the axial terms', () => {
    const k = localStiffness(beam(build()), false);

    near(k[0][0], (E * A) / L);
    near(k[0][3], -(E * A) / L);
  });

  it('puts 4EI/L in the rotation terms', () => {
    const k = localStiffness(beam(build()), false);

    near(k[2][2], (4 * E * I) / L);
    near(k[2][5], (2 * E * I) / L);
  });

  it('leaves a released rotation empty once condensed, and keeps it before', () => {
    const element = beam(build([false, true]));

    // condensed: the released end carries no stiffness at all
    expect(localStiffness(element, true)[5][5]).toBeCloseTo(0, 9);
    // uncondensed: the plain beam term is still there, reassembled from the sub-blocks
    near(localStiffness(element, false)[5][5], (4 * E * I) / L);
  });

  it('is the same either way without a hinge', () => {
    const element = beam(build());

    expect(localStiffness(element, true)).toEqual(localStiffness(element, false));
  });

  it('leaves a beam along x unrotated in the global system', () => {
    const element = beam(build());

    // the element runs along +x, so global and local coincide
    near(globalStiffness(element)[0][0], (E * A) / L);
    expect(transformation(element)[0][0]).toBeCloseTo(1, 9);
  });
});

describe('the end force vectors', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const loaded = (hinges: [boolean, boolean] = [false, false]) => {
    const store = build(hinges);

    store.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, Q], true);
    store.solve();

    return store;
  };

  it('carries ql²/12 at each end of a clamped beam', () => {
    const store = loaded();
    const { primary } = endForcesLocal(beam(store), store.solver.loadCases[0]);

    // moments at the two ends, equal and opposite
    near(Math.abs(primary[2][0]), (Q * L * L) / 12);
    near(Math.abs(primary[5][0]), (Q * L * L) / 12);
    expect(primary[2][0]).toBeCloseTo(-primary[5][0], 6);
  });

  it('carries ql/2 of shear at each end', () => {
    const store = loaded();
    const { primary } = endForcesLocal(beam(store), store.solver.loadCases[0]);

    near(Math.abs(primary[1][0]), (Q * L) / 2);
    near(Math.abs(primary[4][0]), (Q * L) / 2);
  });

  it('adds up: primary plus secondary is what the element carries', () => {
    const store = loaded();
    const { primary, secondary, total } = endForcesLocal(beam(store), store.solver.loadCases[0]);

    for (let i = 0; i < 6; i++) {
      expect(primary[i][0] + secondary[i][0], `row ${i}`).toBeCloseTo(total[i][0], 6);
    }
  });

  it('adds up with a hinge too, once the release is condensed out', () => {
    const store = loaded([false, true]);
    const { primary, secondary, total } = endForcesLocal(beam(store), store.solver.loadCases[0]);

    for (let i = 0; i < 6; i++) {
      expect(primary[i][0] + secondary[i][0], `row ${i}`).toBeCloseTo(total[i][0], 6);
    }
  });

  it('carries no fixed end moment at a released end', () => {
    const store = loaded([false, true]);
    const { primary } = endForcesLocal(beam(store), store.solver.loadCases[0]);

    // the clamped beam would put ql²/12 there; the hinge cannot hold it
    expect(primary[5][0]).toBeCloseTo(0, 6);
    // and it lands on the end that can: ql²/8
    near(Math.abs(primary[2][0]), (Q * L * L) / 8);
  });

  it('moves the fixed end moment to ql²/8 when the far end is released', () => {
    const store = loaded([false, true]);
    const { total } = endForcesLocal(beam(store), store.solver.loadCases[0]);

    near(Math.abs(total[2][0]), (Q * L * L) / 8);
    expect(total[5][0]).toBeCloseTo(0, 6);
  });

  it('leaves the vectors unrotated for a beam along x', () => {
    const store = loaded();
    const lc = store.solver.loadCases[0];
    const local = endForcesLocal(beam(store), lc);
    const global = endForcesGlobal(beam(store), lc);

    for (let i = 0; i < 6; i++) {
      expect(global.total[i][0], `row ${i}`).toBeCloseTo(local.total[i][0], 6);
    }
  });
});

describe('assembling from chosen elements', () => {
  beforeEach(() => setActivePinia(createPinia()));

  /** Two beams in a row, so each has a share of the matrix and they overlap at the middle node. */
  const twoSpan = () => {
    const store = useProjectStore();
    const domain = store.solver.domain;

    domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
    domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
    domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    domain.createNode('2', [L, 0, 0], []);
    domain.createNode('3', [2 * L, 0, 0], [DofID.Dz]);
    domain.createBeam2D('a', ['1', '2'], 'm', 'cs');
    domain.createBeam2D('b', ['2', '3'], 'm', 'cs');
    store.solve();

    return store;
  };

  const beams = (store: ReturnType<typeof useProjectStore>) =>
    ['a', 'b'].map((l) => store.solver.domain.getElement(l)) as never[];

  it('every element together is the assembled structure matrix', () => {
    const store = twoSpan();
    const assembled = assembleFrom(store.solver, beams(store), false);
    const solverMatrix = systemStiffness(store.solver, false);

    for (let i = 0; i < solverMatrix.length; i++) {
      for (let j = 0; j < solverMatrix.length; j++) {
        near(assembled[i][j], solverMatrix[i][j], 1e-9);
      }
    }
  });

  it('one element fills only the rows its own degrees of freedom occupy', () => {
    const store = twoSpan();
    const [first] = beams(store);
    const only = assembleFrom(store.solver, [first], false);
    const touched = (first as unknown as { getLocationArray: () => number[] }).getLocationArray();

    for (let i = 0; i < only.length; i++) {
      if (touched.includes(i)) continue;
      // a row no chosen element reaches stays empty
      expect(
        only[i].every((v) => v === 0),
        `row ${i}`
      ).toBe(true);
    }
  });

  it('keeps the structure size, so it reads against the full matrix', () => {
    const store = twoSpan();

    expect(assembleFrom(store.solver, beams(store), false)).toHaveLength(store.solver.neq + store.solver.pneq);
    expect(assembleFrom(store.solver, beams(store), true)).toHaveLength(store.solver.neq);
  });
});

describe('the system matrix', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('reduces to the block the structure is solved on', () => {
    const store = build();
    store.solve();

    const full = systemStiffness(store.solver, false);
    const reduced = systemStiffness(store.solver, true);

    expect(reduced).toHaveLength(store.solver.neq);
    expect(full.length).toBe(store.solver.neq + store.solver.pneq);
    expect(full.length).toBeGreaterThanOrEqual(reduced.length);
  });

  it('is symmetric', () => {
    const store = build();
    store.solve();

    const k = systemStiffness(store.solver, false);

    for (let i = 0; i < k.length; i++) {
      for (let j = i + 1; j < k.length; j++) {
        expect(k[i][j], `${i},${j}`).toBeCloseTo(k[j][i], 6);
      }
    }
  });
});

describe('the nodal load vector and the right-hand side', () => {
  beforeEach(() => setActivePinia(createPinia()));

  /** A simply supported beam under a uniform load: nothing prescribed, so b is plainly f[free]. */
  const buildLoaded = () => {
    const store = useProjectStore();
    const domain = store.solver.domain;

    domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
    domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
    domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    domain.createNode('2', [L, 0, 0], [DofID.Dz]);
    domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
    store.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, Q], true);

    return store;
  };

  it('sums to the work-equivalent shear at a simply supported end', () => {
    const store = buildLoaded();
    store.solve();

    const f = nodalLoadVector(store.solver, store.solver.loadCases[0]).flat();
    // node 1's Dz is the second free unknown - Dx, free but unloaded, comes first
    const atNode1Dz = store.solver.nodeCodeNumbers.get('1')![DofID.Dz];

    // qL/2 at each end, the textbook value a uniform load's consistent nodal force reduces to
    near(Math.abs(f[atNode1Dz]), (Q * L) / 2, 1e-3);
  });

  it('is exactly f on the free block when nothing is prescribed', () => {
    const store = buildLoaded();
    store.solve();

    const f = nodalLoadVector(store.solver, store.solver.loadCases[0]).flat().slice(0, store.solver.neq);
    const b = rightHandSide(store.solver, store.solver.loadCases[0]).flat();

    expect(b).toEqual(f);
  });

  it('has no entry past the free block', () => {
    const store = buildLoaded();
    store.solve();

    expect(rightHandSide(store.solver, store.solver.loadCases[0])).toHaveLength(store.solver.neq);
  });

  /**
   * The strongest check there is: whatever b came out to, K(free,free)·r(free) has to equal it,
   * because that is the equation `solve()` actually solved - checked against the solved r rather
   * than against the formula this re-derives it with.
   */
  it('is what the free block was solved against', () => {
    const store = useProjectStore();
    const domain = store.solver.domain;

    domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
    domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
    domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
    domain.createNode('2', [L, 0, 0], [DofID.Dx, DofID.Dz]);
    domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
    // a support that has moved, so the free block is solved against more than f alone
    store.solver.loadCases[0].createPrescribedDisplacement('2', { [DofID.Dz]: 0.02 });

    store.solve();

    const b = rightHandSide(store.solver, store.solver.loadCases[0]).flat();
    const r = store.solver.loadCases[0].r.toArray() as number[];
    const kFull = systemStiffness(store.solver, false);

    const reconstructed = kFull
      .slice(0, store.solver.neq)
      .map((row) => row.slice(0, store.solver.neq).reduce((sum, k, j) => sum + k * r[j], 0));

    b.forEach((value, i) => near(value, reconstructed[i], 1e-6));

    // and it does differ from the plain load vector - the prescribed displacement is doing something
    const f = nodalLoadVector(store.solver, store.solver.loadCases[0]).flat().slice(0, store.solver.neq);

    expect(b).not.toEqual(f);
  });

  it('solutionVector spans the prescribed equations too, unlike b', () => {
    const store = useProjectStore();
    const domain = store.solver.domain;

    domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
    domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
    domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
    domain.createNode('2', [L, 0, 0], [DofID.Dx, DofID.Dz]);
    domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
    store.solver.loadCases[0].createPrescribedDisplacement('2', { [DofID.Dz]: 0.02 });

    store.solve();

    const r = solutionVector(store.solver.loadCases[0]).flat();

    expect(r).toHaveLength(store.solver.neq + store.solver.pneq);
    expect(r).toEqual(store.solver.loadCases[0].r.toArray());
    near(r[r.length - 1], 0.02, 1e-9);
  });
});

describe('naming the degrees of freedom', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('names an element’s six by the nodes they belong to', () => {
    const names = elementDofNames(beam(build()));

    expect(names).toEqual(['u (1)', 'w (1)', 'φ (1)', 'u (2)', 'w (2)', 'φ (2)']);
  });

  it('follows a node that has been renamed', () => {
    const store = build();

    // as the app renames one: the element's reference is re-pointed with it
    changeLabel('nodes', store.solver.domain.nodes.get('1')!, { value: 'left' } as HTMLInputElement);

    expect(elementDofNames(beam(store))[0]).toBe('u (left)');
  });

  it('names every equation of the structure the same way', () => {
    const store = build();
    store.solve();

    const names = structureDofNames(store.solver);

    expect(names).toHaveLength(store.solver.neq + store.solver.pneq);
    // both nodes are clamped here, so every equation belongs to one of them
    expect(names.every((n) => n.includes('(1)') || n.includes('(2)'))).toBe(true);
    expect(names.filter((n) => n.startsWith('φ'))).toHaveLength(2);
  });

  it('puts a name against the equation the solver actually used', () => {
    const store = build();
    store.solve();

    const names = structureDofNames(store.solver);
    const element = beam(store) as unknown as { getLocationArray: () => number[] };
    const where = element.getLocationArray();

    // the element's own six line up with the same six equations of the structure
    expect(where.map((eq) => names[eq])).toEqual(elementDofNames(beam(store)));
  });
});

describe('dropping what is empty', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('keeps only the rows and columns that carry something', () => {
    const grid = [
      [1, 0, 2],
      [0, 0, 0],
      [2, 0, 3],
    ];

    expect(occupied(grid)).toEqual([0, 2]);
    expect(only(grid, occupied(grid))).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it('keeps a row that is empty but whose column is not', () => {
    // an unsymmetric matrix should not lose the term that is there
    const grid = [
      [0, 0],
      [5, 0],
    ];

    expect(occupied(grid)).toEqual([0, 1]);
  });

  it('leaves a full matrix alone', () => {
    const store = build();
    store.solve();

    const k = systemStiffness(store.solver, true);

    expect(occupied(k)).toHaveLength(k.length);
  });

  it('cuts an assembly from one element down to that element', () => {
    const store = useProjectStore();
    const domain = store.solver.domain;

    domain.createMaterial('m', { e: E, g: 81e9, alpha: 1.2e-5, d: 7850 });
    domain.createCrossSection('cs', { a: A, iy: I, h: 0.2, k: 1e6 });
    domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
    domain.createNode('2', [L, 0, 0], []);
    domain.createNode('3', [2 * L, 0, 0], [DofID.Dz]);
    domain.createBeam2D('a', ['1', '2'], 'm', 'cs');
    domain.createBeam2D('b', ['2', '3'], 'm', 'cs');
    store.solve();

    const first = store.solver.domain.getElement('a') as never;
    const assembled = assembleFrom(store.solver, [first], false);

    // one beam reaches six equations, whatever the structure around it has
    expect(occupied(assembled)).toHaveLength(6);
  });
});
