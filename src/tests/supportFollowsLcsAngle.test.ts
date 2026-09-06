import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import { Domain, DofID, LoadCase, Solver } from 'ts-fem';
import SVGNode from '@/components/svg/Node.vue';
import { applyNodeLcsAngle } from '@/utils';

/**
 * A support symbol is drawn along a two point segment, and its direction is that segment's. When a
 * node is given an angle its own axes decide that direction - for every support, not only the ones
 * that leave the rotation free.
 *
 * The fixed support used to be the exception: the direction was read from the constrained DOFs,
 * where `isOrientedSupport` wants Ry free and `isMovingCantilever` excludes the fully fixed case,
 * so a fixed support fell through to being lined up with its element and ignored the angle.
 */
const build = (bcs: DofID[]) => {
  const solver = new Solver();
  const domain = new Domain(solver);

  solver.domain = domain;
  solver.loadCases = [new LoadCase(solver)];

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e-3 });
  domain.createNode('1', [0, 0, 0], bcs);
  domain.createNode('2', [4, 0, 0], []);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');

  return { solver, node: domain.nodes.get('1')! };
};

/** The angle of the segment the support symbol is drawn along, in degrees. */
const symbolAngle = (bcs: DofID[], lcsDegrees: number | null) => {
  const { solver, node } = build(bcs);
  if (lcsDegrees !== null) applyNodeLcsAngle(node, lcsDegrees);

  const wrapper = mount(SVGNode, {
    props: { node, scale: 1, showSupports: true, loadCase: solver.loadCases[0] },
    global: { plugins: [createVuetify()] },
  });

  const points = wrapper.find('polyline.decoration').attributes('points')!;
  const [from, to] = points.split(' ').map((p) => p.split(',').map(Number));

  return (Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI;
};

const FIXED = [DofID.Dx, DofID.Dz, DofID.Ry];
const PINNED = [DofID.Dx, DofID.Dz];

describe('a support symbol on a node with its own axes', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('turns with the angle when the node is pinned', () => {
    expect(symbolAngle(PINNED, 30)).toBeCloseTo(30, 6);
  });

  it('turns with the angle when the node is fixed', () => {
    expect(symbolAngle(FIXED, 30)).toBeCloseTo(30, 6);
  });

  it('follows the angle it is given, not a fixed one', () => {
    expect(symbolAngle(FIXED, 75)).toBeCloseTo(75, 6);
    expect(symbolAngle(FIXED, -40)).toBeCloseTo(-40, 6);
  });

  it('leaves a node without its own axes as it was', () => {
    // no lcs: the direction comes from the element, which runs along +x
    expect(Math.abs(symbolAngle(FIXED, null))).toBeCloseTo(0, 6);
  });
});
