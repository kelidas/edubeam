import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { LinearStaticSolver } from 'ts-fem';
import Deformation from '../components/svg/ElementConcentratedDeformation.vue';

/** The drawing is in model units, so the scale is how many pixels of symbol go to one of them. */
const SCALE = 10;

const drawn = (values: number[], scale = SCALE) => {
  const solver = new LinearStaticSolver();
  const d = solver.domain;

  d.createNode(1, [0, 0, 0], []);
  d.createNode(2, [4, 0, 0], []);
  d.createMaterial(1, { e: 1, g: 1, alpha: 0, d: 0 });
  d.createCrossSection(1, { a: 1, iy: 1, h: 1, k: 1 });
  d.createBeam2D(1, [1, 2], 1, 1);
  solver.loadCases[0].createBeamConcentratedDeformation(1, values, true);

  return mount(Deformation, {
    props: {
      eload: solver.loadCases[0].elementLoadList[0],
      scale,
      convertDisplacement: (v: number) => v,
      numberFormat: new Intl.NumberFormat(),
    },
  });
};

const turnOf = (transform: string) => Number(/rotate\(([-\d.e]+)/.exec(transform)![1]);
const alongOf = (transform: string) => Number(/translate\(([-\d.e]+)/.exec(transform)![1]);
const acrossOf = (transform: string) => Number(/translate\([-\d.e]+ ([-\d.e]+)/.exec(transform)![1]);
const startOf = (points: string) => points.split(' ')[0].split(',').map(Number);

describe('imposed deformation symbol', () => {
  it('draws a dashed shaft along the arrow', () => {
    const solver = new LinearStaticSolver();
    const d = solver.domain;
    d.createNode(1, [0, 0, 0], []);
    d.createNode(2, [4, 0, 0], []);
    d.createMaterial(1, { e: 1, g: 1, alpha: 0, d: 0 });
    d.createCrossSection(1, { a: 1, iy: 1, h: 1, k: 1 });
    d.createBeam2D(1, [1, 2], 1, 1);
    solver.loadCases[0].createBeamConcentratedDeformation(1, [0, -1, 0, 2], true);

    const wrapper = mount(Deformation, {
      props: {
        eload: solver.loadCases[0].elementLoadList[0],
        scale: 10,
        convertDisplacement: (v: number) => v,
        numberFormat: new Intl.NumberFormat(),
      },
    });

    const shaft = wrapper.find('polyline.decoration.shaft');
    expect(shaft.exists()).toBe(true);
    expect(shaft.attributes('stroke-dasharray')).toBe('6 4');
  });

  /**
   * An imposed deformation is a relative movement of the two faces of a section, not something
   * applied to one point of it. Drawn as one arrow it reads as a load; drawn as two against each
   * other it reads as a release, which is what an influence line is drawn from.
   */
  it('draws an arrow for each face of the cut', () => {
    const wrapper = drawn([0, -1, 0, 2]);

    expect(wrapper.findAll('polyline.decoration.force')).toHaveLength(2);
    expect(wrapper.findAll('polyline.decoration.shaft')).toHaveLength(2);
  });

  it('points the two against each other', () => {
    const turns = drawn([0, -1, 0, 2])
      .findAll('polyline.decoration.force')
      .map((a) => turnOf(a.attributes('transform')!));
    const between = (((turns[1] - turns[0]) % 360) + 360) % 360;

    expect(Math.abs(between - 180)).toBeLessThan(1e-6);
  });

  const shaftsAlong = (values: number[], scale = SCALE) =>
    drawn(values, scale)
      .findAll('polyline.decoration.shaft')
      .map((shaft) => startOf(shaft.attributes('points')!)[0]);

  it('stands them either side of the section', () => {
    const along = shaftsAlong([0, -1, 0, 2]);

    expect(along[0]).toBeLessThan(2);
    expect(along[1]).toBeGreaterThan(2);
  });

  it('keeps them the same distance apart on the screen at any zoom', () => {
    const near = shaftsAlong([0, -1, 0, 2], SCALE);
    const far = shaftsAlong([0, -1, 0, 2], SCALE * 4);

    // four times the zoom, a quarter of the model distance: the gap is a fixed number of pixels
    expect(Math.abs(near[1] - near[0])).toBeCloseTo(Math.abs(far[1] - far[0]) * 4, 9);
  });

  it('puts the head at the far end, so the arrow points away from the beam', () => {
    const wrapper = drawn([0, -1, 0, 2]);
    const head = wrapper.find('polyline.decoration.force').attributes('transform')!;
    const [fromX, fromZ] = startOf(wrapper.find('polyline.decoration.shaft').attributes('points')!);

    expect(Math.hypot(alongOf(head) - fromX, acrossOf(head) - fromZ)).toBeCloseTo(40 / SCALE, 6);
  });

  /**
   * The two moment markers are not mirror images of one another - they hang from different points -
   * so a pair built from one of each sat crooked. The pair is one marker and its mirror instead,
   * which gives it the symmetry the section itself has.
   */
  it('draws two moments against each other for an imposed rotation', () => {
    const arcs = drawn([0, 0, 1, 2]).findAll('polyline.decoration.moment');

    expect(arcs).toHaveLength(2);

    const transforms = arcs.map((a) => a.attributes('transform')!);

    expect(transforms.filter((t) => t.includes('scale(-1 1)'))).toHaveLength(1);
  });

  it('turns the pair over with the sign, rather than turning one of them', () => {
    const mirrored = (values: number[]) =>
      drawn(values)
        .findAll('polyline.decoration.moment')
        .map((a) => a.attributes('transform')!.includes('scale(-1 1)'));

    // one of the two is mirrored either way, and which one swaps with the sign
    expect(mirrored([0, 0, 1, 2])).toEqual([false, true]);
    expect(mirrored([0, 0, -1, 2])).toEqual([true, false]);
  });

  it('stands the arcs further apart than the arrows, an arc being the wider mark', () => {
    const arcs = drawn([0, 0, 1, 2])
      .findAll('polyline.decoration.moment')
      .map((a) => alongOf(a.attributes('transform')!));
    const shafts = drawn([0, -1, 0, 2])
      .findAll('polyline.decoration.shaft')
      .map((shaft) => startOf(shaft.attributes('points')!)[0]);

    expect(Math.abs(arcs[1] - arcs[0])).toBeGreaterThan(Math.abs(shafts[1] - shafts[0]));
  });

  it('draws nothing of the kind the load does not have', () => {
    expect(drawn([0, -1, 0, 2]).findAll('polyline.decoration.moment')).toHaveLength(0);
    expect(drawn([0, 0, 1, 2]).findAll('polyline.decoration.force')).toHaveLength(0);
  });
});
