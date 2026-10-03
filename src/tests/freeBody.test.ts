import { describe, it, expect } from 'vitest';
import { Beam2D, DofID, LinearStaticSolver } from 'ts-fem';
import { applyNodeLcsAngle } from '@/utils/nodalLcs';
import { elementEndForces, nodeEquilibrium } from '@/utils/freeBody';

const solved = (build: (solver: LinearStaticSolver) => void) => {
  const solver = new LinearStaticSolver();
  solver.domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  solver.domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e32 });
  build(solver);
  solver.solve();

  return solver;
};

const beam = (solver: LinearStaticSolver, label: string, from: string, to: string) =>
  solver.domain.createBeam2D(label, [from, to], 'm', 'cs');

const element = (solver: LinearStaticSolver, label: string) => {
  const e = solver.domain.elements.get(label);
  if (!(e instanceof Beam2D)) throw new Error(`no element ${label}`);
  return e;
};

/** A sum that should be nothing, against the size of what was added up. */
const expectBalanced = (solver: LinearStaticSolver, node: string) => {
  const { contributions, sum } = nodeEquilibrium(solver, node, solver.loadCases[0]);
  const size = Math.max(1, ...contributions.flatMap((c) => [Math.abs(c.fx), Math.abs(c.fz), Math.abs(c.m)]));

  expect(Math.abs(sum.fx) / size).toBeLessThan(1e-9);
  expect(Math.abs(sum.fz) / size).toBeLessThan(1e-9);
  expect(Math.abs(sum.m) / size).toBeLessThan(1e-9);

  return contributions;
};

describe('free body: a node', () => {
  it('balances a simply supported beam under a uniform load at both supports', () => {
    const solver = solved((s) => {
      s.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
      s.domain.createNode('2', [4, 0, 0], [DofID.Dz]);
      beam(s, 'a', '1', '2');
      s.loadCases[0].createBeamElementUniformEdgeLoad('a', [0, 1000], true);
    });

    const atLeft = expectBalanced(solver, '1');
    expectBalanced(solver, '2');

    // the support holds the node up - against z, which points down - with half the load
    expect(atLeft.find((c) => c.kind === 'reaction')!.fz).toBeCloseTo(-2000, 6);
    // and the beam bears down on it with the same
    expect(atLeft.find((c) => c.kind === 'element')!.fz).toBeCloseTo(2000, 6);
  });

  it('balances a cantilever at its clamp, a moment included', () => {
    const solver = solved((s) => {
      s.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
      s.domain.createNode('2', [2, 0, 0], []);
      beam(s, 'a', '1', '2');
      s.loadCases[0].createNodalLoad('2', { [DofID.Dz]: 1000 });
    });

    const atClamp = expectBalanced(solver, '1');
    expectBalanced(solver, '2');

    // the tip load would turn the beam clockwise on screen; the clamp holds it with a positive,
    // counter-clockwise moment - the sense the drawing turns a positive moment in
    expect(atClamp.find((c) => c.kind === 'reaction')!.m).toBeCloseTo(2000, 6);
  });

  it('balances the knees of a portal frame, where a load and two elements meet', () => {
    const solver = solved((s) => {
      s.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
      s.domain.createNode('2', [0, 0, -3], []);
      s.domain.createNode('3', [4, 0, -3], []);
      s.domain.createNode('4', [4, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
      beam(s, 'a', '1', '2');
      beam(s, 'b', '2', '3');
      beam(s, 'c', '3', '4');
      s.loadCases[0].createNodalLoad('2', { [DofID.Dx]: 500 });
      s.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, 2000], true);
    });

    for (const node of ['1', '2', '3', '4']) expectBalanced(solver, node);
    expect(nodeEquilibrium(solver, '2', solver.loadCases[0]).contributions.map((c) => c.kind)).toEqual([
      'element',
      'element',
      'load',
    ]);
  });

  it('balances a node on a rotated support that also carries a load', () => {
    const solver = solved((s) => {
      s.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
      s.domain.createNode('2', [4, 0, 0], [DofID.Dz]);
      applyNodeLcsAngle(s.domain.getNode('2'), 30);
      beam(s, 'a', '1', '2');
      s.loadCases[0].createBeamElementUniformEdgeLoad('a', [0, 1000], true);
      s.loadCases[0].createNodalLoad('2', { [DofID.Dx]: 300, [DofID.Dz]: 200 });
    });

    expectBalanced(solver, '1');
    expectBalanced(solver, '2');
  });
});

describe('free body: an element', () => {
  it('turns the local end forces into global ones by the element direction', () => {
    const solver = solved((s) => {
      s.domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
      s.domain.createNode('2', [3, 0, -4], [DofID.Dx, DofID.Dz]);
      beam(s, 'a', '1', '2');
      s.loadCases[0].createBeamElementUniformEdgeLoad('a', [0, 1000], false);
    });

    const { local, global } = elementEndForces(element(solver, 'a'), solver.loadCases[0]);

    for (const end of [0, 1]) {
      expect(Math.hypot(global[end].fx, global[end].fz)).toBeCloseTo(Math.hypot(local[end].fx, local[end].fz), 6);
      expect(global[end].m).toBe(local[end].m);
    }
    // a vertical load on an inclined element: the two ends between them carry all of it, vertically
    expect(global[0].fx + global[1].fx).toBeCloseTo(0, 6);
    expect(global[0].fz + global[1].fz).toBeCloseTo(-5000, 6);
  });
});
