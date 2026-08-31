import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { LinearStaticSolver } from 'ts-fem';
import Deformation from '../components/svg/ElementConcentratedDeformation.vue';

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
});
