import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { i18n } from '@/plugins/i18n';
import BottomBar from '@/components/BottomBar.vue';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';

/**
 * Every row of the loads table has to render, whatever the load - a helper the template calls but
 * the script no longer has throws during render, and Vue does not fail the build over it: the
 * table silently loses that one row, which is how a prescribed displacement once went missing from
 * a merge without a test noticing.
 */
const build = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
  domain.createNode('2', [4, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
  store.solver.loadCases[0].createPrescribedDisplacement('1', { [DofID.Dz]: 0.01 });

  return store;
};

const open = () => {
  useAppStore().bottomBarTab = 'tab-loads';

  return mount(BottomBar, {
    global: { plugins: [createVuetify({ components, directives }), i18n] },
  });
};

describe('the loads table', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('shows a prescribed displacement, not a row of nothing', () => {
    build();
    const wrapper = open();

    const row = wrapper.findAll('tbody tr').find((tr) => tr.text().includes('Prescribed displacement'));

    expect(row).toBeTruthy();
    // the DOF labels are what the row is for; a row that rendered but lost its inputs is as
    // useless as one that never rendered
    expect(row!.text()).toContain('Dx');
    expect(row!.text()).toContain('Dz');
  });
});
