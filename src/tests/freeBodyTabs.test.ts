import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { i18n } from '@/plugins/i18n';
import { useProjectStore } from '@/store/project';
import ElementMatrices from '@/components/ElementMatrices.vue';

/** A portal frame: two clamps, a load on the left knee and a uniform load on the beam. */
const build = (solve = true) => {
  const store = useProjectStore();
  const { domain } = store.solver;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e32 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
  domain.createNode('2', [0, 0, -3], []);
  domain.createNode('3', [4, 0, -3], []);
  domain.createNode('4', [4, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
  domain.createBeam2D('a', ['1', '2'], 'm', 'cs');
  domain.createBeam2D('b', ['2', '3'], 'm', 'cs', [false, true]);
  domain.createBeam2D('c', ['3', '4'], 'm', 'cs');
  store.solver.loadCases[0].createNodalLoad('2', { [DofID.Dx]: 5000 });
  store.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, 2000], true);

  if (solve) store.solver.solve();

  return store;
};

const global = { plugins: [i18n, createVuetify({ components, directives })] };

const tab = (wrapper: ReturnType<typeof mount>, title: string) =>
  wrapper.findAll('.v-tab').find((t) => t.text() === title)!;

describe('the free body tabs of the matrices widget', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('opens on a node and adds up what acts on it, a load included', () => {
    build();
    const wrapper = mount(ElementMatrices, { props: { node: '2' }, global });

    const names = wrapper.findAll('tbody tr').map((r) => r.find('th').text());
    expect(names).toEqual([
      `${i18n.global.t('common.element')} a`,
      `${i18n.global.t('common.element')} b`,
      i18n.global.t('freeBody.load'),
      'Σ',
    ]);
    expect(wrapper.text()).toContain(i18n.global.t('freeBody.balanced'));
  });

  it('lists the reaction at a clamp', () => {
    build();
    const wrapper = mount(ElementMatrices, { props: { node: '1' }, global });

    expect(wrapper.findAll('tbody tr th').map((th) => th.text())).toContain(i18n.global.t('freeBody.reaction'));
  });

  it('draws an element with its load, its hinge and the forces at its ends', async () => {
    build();
    const wrapper = mount(ElementMatrices, { props: { label: 'b' }, global });

    await tab(wrapper, i18n.global.t('freeBody.elementTab')).trigger('click');

    const svg = wrapper.find('svg.free-body');
    expect(svg.exists()).toBe(true);
    // the released end is an open circle, the other a plain joint
    expect(svg.findAll('circle.hinge')).toHaveLength(1);
    expect(svg.findAll('circle.joint')).toHaveLength(1);
    // the uniform load is a band of arrows
    expect(svg.findAll('.load polygon.band')).toHaveLength(1);
    expect(svg.findAll('.force polygon').length).toBeGreaterThan(0);
  });

  it('says there is nothing to draw before a solve, and when the node is gone', async () => {
    const store = build(false);
    const wrapper = mount(ElementMatrices, { props: { node: '2' }, global });

    expect(wrapper.text()).toContain(i18n.global.t('common.notSolved'));

    store.solver.solve();
    store.solver.domain.nodes.delete('2');
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain(i18n.global.t('freeBody.nodeMissing', { label: '2' }));
  });
});
