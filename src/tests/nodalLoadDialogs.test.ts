import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { i18n } from '@/plugins/i18n';
import AddNodalLoad from '@/components/dialogs/AddNodalLoad.vue';
import EditNodalLoad from '@/components/dialogs/EditNodalLoad.vue';
import { useAppStore } from '@/store/app';
import { useProjectStore } from '@/store/project';
import { DofID } from 'ts-fem';

/**
 * A force and a prescribed displacement used to each carry their own copy of this conversion -
 * Add wrote it one way, Edit another, and the two had already drifted (Add kept `realDx`/`realDz`/
 * `realRy` beside `realFx`/`realFz`/`realMy`, Edit had folded them into one computed each). Both
 * dialogs now read `NodalLoadForm.ts` through `NodalLoadFields.vue`, the way the element load
 * dialogs already share `ElementLoadForm.ts` - one place for the conversion to be right or wrong.
 */
const build = () => {
  const domain = useProjectStore().solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e-3 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
  domain.createNode('2', [4, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
};

// happy-dom has no visualViewport, which Vuetify's overlay reads on mount
if (!('visualViewport' in window)) {
  Object.defineProperty(window, 'visualViewport', {
    value: {
      width: 1024,
      height: 768,
      scale: 1,
      offsetLeft: 0,
      offsetTop: 0,
      addEventListener() {},
      removeEventListener() {},
    },
    configurable: true,
  });
}

const globalPlugins = { plugins: [createVuetify({ components, directives }), i18n] };

const openAdd = (props: Record<string, unknown> = {}) => {
  build();
  return mount(AddNodalLoad, { props, global: globalPlugins });
};

const fields = (wrapper: VueWrapper<unknown>) => wrapper.findComponent({ name: 'NodalLoadFields' });

describe('the add nodal load dialog', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('opens on a force, labelled F, outside the influence workspace', () => {
    const form = fields(openAdd({ label: '1' }));

    expect((form.vm as unknown as { loadType: string }).loadType).toBe('force');
    expect((form.vm as unknown as { mainLabel: string }).mainLabel).toBe('F');
    expect((form.vm as unknown as { mainUnits: string }).mainUnits).toBe('kN');
  });

  it('opens on a displacement, labelled D, in the influence workspace', async () => {
    build();
    const appStore = useAppStore();
    appStore.tab = appStore.tabs.findIndex((t) => t.props.id === 'influence');

    const wrapper = mount(AddNodalLoad, { props: { label: '1' }, global: globalPlugins });
    // AddNodalLoad sets loadType in its own onMounted, which fires after the field's; the
    // v-model sync back down to the child's defineModel needs a tick to show up here.
    await wrapper.vm.$nextTick();
    const form = fields(wrapper);

    expect((form.vm as unknown as { loadType: string }).loadType).toBe('displacement');
    expect((form.vm as unknown as { mainLabel: string }).mainLabel).toBe('D');
    expect((form.vm as unknown as { mainUnits: string }).mainUnits).toBe('m');
  });

  it('converts a force typed in kN to N on the model', async () => {
    const store = useProjectStore();
    const wrapper = openAdd({ label: '1' });
    const form = fields(wrapper);

    (form.vm as unknown as { fx: string }).fx = '5';
    await wrapper.vm.$nextTick();

    (wrapper.vm as unknown as { addNodalLoad: () => void }).addNodalLoad();

    expect(store.loadCase.nodalLoadList[0].values[DofID.Dx]).toBeCloseTo(5000);
  });

  it('keeps a prescribed rotation in radians, unconverted', async () => {
    const store = useProjectStore();
    const wrapper = openAdd({ label: '1', type: 'displacement' });
    const form = fields(wrapper);

    (form.vm as unknown as { my: string }).my = '0.02';
    await wrapper.vm.$nextTick();

    (wrapper.vm as unknown as { addNodalLoad: () => void }).addNodalLoad();

    expect(store.loadCase.prescribedBC[0].prescribedValues[DofID.Ry]).toBeCloseTo(0.02);
  });
});

describe('the edit nodal load dialog', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('shows a stored force back in kN, the same value it was typed in', async () => {
    const store = useProjectStore();
    build();
    store.loadCase.createNodalLoad('1', { [DofID.Dx]: 5000 });

    const form = fields(mount(EditNodalLoad, { props: { index: 0 }, global: globalPlugins }));
    await form.vm.$nextTick();

    expect((form.vm as unknown as { fx: string }).fx).toBe('5');
  });

  it('shows a stored displacement back in its own units, not the force ones', async () => {
    const store = useProjectStore();
    build();
    store.loadCase.createPrescribedDisplacement('1', { [DofID.Dx]: 0.01 });

    const form = fields(mount(EditNodalLoad, { props: { index: 0, type: 'displacement' }, global: globalPlugins }));
    await form.vm.$nextTick();

    expect((form.vm as unknown as { mainLabel: string }).mainLabel).toBe('D');
    expect((form.vm as unknown as { fx: string }).fx).toBe('0.01');
  });

  it('disables a field whose DOF is not supported at the node', () => {
    build();
    const store = useProjectStore();
    // node 2 only supports Dz, so a displacement there can only ever touch Dz
    store.loadCase.createPrescribedDisplacement('2', { [DofID.Dz]: 0 });

    const form = fields(mount(EditNodalLoad, { props: { index: 0, type: 'displacement' }, global: globalPlugins }));
    const nodeBcs = (form.vm as unknown as { nodeBcs: Set<number> }).nodeBcs;

    expect(nodeBcs.has(DofID.Dz)).toBe(true);
    expect(nodeBcs.has(DofID.Dx)).toBe(false);
  });
});
