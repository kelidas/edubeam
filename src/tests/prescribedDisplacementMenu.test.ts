import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';
import ContextMenuPrescribedDisplacement from '@/components/ContextMenuPrescribedDisplacement.vue';

/**
 * The influence line workspace keeps its own load case, and a prescribed displacement made there
 * belongs to it. A menu that looks the selected one up in the first case finds nothing there - and
 * the deletion, which removes from the active case, then has nothing to remove either.
 */
const vuetify = createVuetify({ components, directives });

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

/**
 * Switching workspace clears the selection - a selection made on one tab indexes into the other
 * case - and that runs on the next tick, so anything selected has to be selected after it.
 */
const openInfluenceWorkspace = async () => {
  const app = useAppStore();

  app.tab = app.tabs.findIndex((tab) => tab.props?.id === 'influence');
  await nextTick();
};

const clickDelete = async () => {
  const wrapper = mount(ContextMenuPrescribedDisplacement, {
    global: { plugins: [vuetify], mocks: { $t: (key: string) => key } },
  });
  const item = wrapper.findAll('.v-list-item').find((entry) => entry.text().includes('common.delete'))!;

  await item.trigger('click');
};

const select = (index: number) => {
  const store = useProjectStore();

  store.selection.type = 'prescribedDisplacement';
  store.selection.label = String(index);
};

describe('deleting a prescribed displacement from its menu', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('deletes the one selected in the viewer', async () => {
    const store = build();

    store.loadCase.createPrescribedDisplacement('1', { [DofID.Dz]: 0.01 });
    select(0);

    await clickDelete();

    expect(store.loadCase.prescribedBC).toHaveLength(0);
  });

  it('deletes the one selected in the influence workspace, which is a case of its own', async () => {
    const store = build();

    store.influenceLoadCase();
    await openInfluenceWorkspace();
    store.loadCase.createPrescribedDisplacement('1', { [DofID.Dz]: 1 });
    select(0);

    expect(store.loadCase.prescribedBC).toHaveLength(1);

    await clickDelete();

    expect(store.loadCase.prescribedBC).toHaveLength(0);
  });

  it('leaves the other workspace untouched', async () => {
    const store = build();

    store.solver.loadCases[0].createPrescribedDisplacement('1', { [DofID.Dz]: 0.01 });
    store.influenceLoadCase();
    await openInfluenceWorkspace();
    store.loadCase.createPrescribedDisplacement('2', { [DofID.Dz]: 1 });
    select(0);

    await clickDelete();

    expect(store.loadCase.prescribedBC).toHaveLength(0);
    expect(store.solver.loadCases[0].prescribedBC).toHaveLength(1);
  });
});
