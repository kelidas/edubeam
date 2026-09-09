import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { i18n } from '@/plugins/i18n';
import ElementMatrices from '@/components/ElementMatrices.vue';
import { useProjectStore } from '@/store/project';

/**
 * The widget is where the two pictures meet - an element's own matrices, and the structure they are
 * assembled into - so what it offers depends on what it was opened on. Opened on the structure
 * there is no element to show; opened on an element there is everything.
 */
const build = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [4, 0, 0], []);
  domain.createNode('3', [8, 0, 0], [DofID.Dz]);
  domain.createBeam2D('a', ['1', '2'], 'm', 'cs');
  domain.createBeam2D('b', ['2', '3'], 'm', 'cs');
  store.solve();

  return store;
};

const open = (props: { label?: string }) =>
  mount(ElementMatrices, {
    props,
    global: { plugins: [createVuetify({ components, directives }), i18n] },
  });

const tabs = (wrapper: ReturnType<typeof open>) => wrapper.findAll('.v-tab').map((t) => t.text());

describe('the matrices widget', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('offers every tab when opened on an element', () => {
    build();

    expect(tabs(open({ label: 'a' })).length).toBeGreaterThan(1);
  });

  it('offers only the structure when opened without one', () => {
    build();
    const names = tabs(open({}));

    expect(names).toHaveLength(1);
    expect(names[0]).toBe('Structure');
  });

  it('counts the elements picked in the drawing', async () => {
    const store = build();
    const wrapper = open({});

    store.selection2.elements = ['a'];
    await nextTick();

    // the label carries the count, which is what enables the switch
    expect(wrapper.text()).toContain('(1)');
  });

  it('counts nothing when nothing is picked', () => {
    build();

    expect(open({}).text()).toContain('(0)');
  });

  it('writes a negative zero as zero', () => {
    build();
    const wrapper = open({ label: 'a' });

    // a beam along x has -sin in its transformation, which is negative zero
    expect(wrapper.text()).not.toContain('-0 ');
  });
});

describe('what the matrices are indexed by', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const rowLabels = (wrapper: ReturnType<typeof open>) => wrapper.findAll('tbody th').map((th) => th.text());

  const openTab = async (wrapper: ReturnType<typeof open>, title: string) => {
    await wrapper
      .findAll('.v-tab')
      .find((t) => t.text() === title)!
      .trigger('click');
    await nextTick();
  };

  it('names the rows by the nodes rather than by the element ends', () => {
    build();

    // element 'b' runs between nodes 2 and 3
    expect(rowLabels(open({ label: 'b' }))).toEqual(['u (2)', 'w (2)', 'φ (2)', 'u (3)', 'w (3)', 'φ (3)']);
  });

  it('indexes the structure the same way, so an element can be found inside it', async () => {
    build();
    const wrapper = open({ label: 'b' });

    await openTab(wrapper, 'Structure');
    const labels = rowLabels(wrapper);

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => /^[uwφ] \(/.test(l))).toBe(true);
  });

  it('leaves the full structure matrix whole', async () => {
    const store = build();
    const wrapper = open({ label: 'b' });

    await openTab(wrapper, 'Structure');

    // nothing in an assembled structure is empty, so hiding empties changes nothing
    expect(rowLabels(wrapper)).toHaveLength(store.solver.neq);
  });
});
