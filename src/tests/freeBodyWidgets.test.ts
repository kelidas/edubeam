import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { i18n } from '@/plugins/i18n';
import { useProjectStore } from '@/store/project';
import ElementForces from '@/components/ElementForces.vue';
import NodeEquilibrium from '@/components/NodeEquilibrium.vue';

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
  domain.createBeam2D('b', ['2', '3'], 'm', 'cs');
  domain.createBeam2D('c', ['3', '4'], 'm', 'cs');
  store.solver.loadCases[0].createNodalLoad('2', { [DofID.Dx]: 5000 });
  store.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, 2000], true);

  if (solve) store.solver.solve();

  return store;
};

const global = { plugins: [i18n, createVuetify({ components, directives })] };

const cells = (row: { findAll: (s: string) => { text: () => string }[] }) => row.findAll('td').map((c) => c.text());

describe('node equilibrium widget', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('lists every element, the load and the sum at a loaded knee, and says it balances', () => {
    build();
    const wrapper = mount(NodeEquilibrium, { props: { node: '2' }, global });

    const rows = wrapper.findAll('tbody tr');
    expect(rows.map((r) => cells(r)[0])).toEqual([
      `${i18n.global.t('common.element')} a`,
      `${i18n.global.t('common.element')} b`,
      i18n.global.t('freeBody.load'),
      'Σ',
    ]);
    expect(cells(rows.at(-1)!).slice(1)).toEqual(['0', '0', '0']);
    expect(wrapper.text()).toContain(i18n.global.t('freeBody.balanced'));
    // an arrow for each of the three, and the two elements' moments
    expect(wrapper.findAll('svg polygon').length).toBeGreaterThanOrEqual(5);
  });

  it('includes the reaction at a clamp', () => {
    build();
    const wrapper = mount(NodeEquilibrium, { props: { node: '1' }, global });

    expect(wrapper.findAll('tbody tr').map((r) => cells(r)[0])).toEqual([
      `${i18n.global.t('common.element')} a`,
      i18n.global.t('freeBody.reaction'),
      'Σ',
    ]);
  });

  it('says there is nothing to show before a solve, and when the node is gone', async () => {
    const store = build(false);
    const wrapper = mount(NodeEquilibrium, { props: { node: '2' }, global });

    expect(wrapper.text()).toBe(i18n.global.t('freeBody.notSolved'));

    store.solver.domain.nodes.delete('2');
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBe(i18n.global.t('freeBody.nodeMissing', { label: '2' }));
  });
});

describe('element end forces widget', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('lists both ends, and marks local components until switched to global', async () => {
    build();
    const wrapper = mount(ElementForces, { props: { label: 'b' }, global });

    expect(wrapper.findAll('tbody tr').map((r) => cells(r)[0])).toEqual(['2', '3']);
    expect(wrapper.find('thead').text()).toContain('′');

    await wrapper
      .findAll('button')
      .find((b) => b.text() === i18n.global.t('freeBody.global'))!
      .trigger('click');

    expect(wrapper.find('thead').text()).not.toContain('′');
    // the beam is horizontal, so its own axes are the global ones and the numbers do not change
    expect(wrapper.findAll('tbody tr').map(cells)).toHaveLength(2);
  });

  it('says the element is gone once it is deleted', async () => {
    const store = build();
    const wrapper = mount(ElementForces, { props: { label: 'b' }, global });

    store.solver.domain.elements.delete('b');
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toBe(i18n.global.t('warnings.elementMissing', { label: 'b' }));
  });
});
