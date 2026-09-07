import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { i18n } from '@/plugins/i18n';
import AddElementLoad from '@/components/dialogs/AddElementLoad.vue';
import { useAppStore } from '@/store/app';
import { useProjectStore } from '@/store/project';
import { DofID } from 'ts-fem';

/**
 * An imposed deformation exists to solve influence lines. It is not a load anyone puts on a
 * structure, so the load case viewer must not offer it - the shared load form knows the type, and
 * without this it appeared in both workspaces.
 */
/** The dialog draws a preview of the element it is adding to, so it needs something to draw. */
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

/**
 * `workspace` is derived from the open tab, so it is switched by opening one. Its two values are
 * 'influence' and 'loads' - there is no 'viewer'; that is the tab's id, not the workspace's name.
 */
const typesOffered = (workspace: 'loads' | 'influence') => {
  build();

  const appStore = useAppStore();
  appStore.tab = appStore.tabs.findIndex((t) => t.props.id === (workspace === 'influence' ? 'influence' : 'viewer'));
  expect(appStore.workspace).toBe(workspace);

  const wrapper = mount(AddElementLoad, {
    global: { plugins: [createVuetify({ components, directives }), i18n] },
  });

  return (wrapper.vm as unknown as { loadTypes: { value: string }[] }).loadTypes.map((t) => t.value);
};

describe('the add element load dialog', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('does not offer an imposed deformation in the load case viewer', () => {
    expect(typesOffered('loads')).not.toContain('concentrated_deformation');
  });

  it('still offers the ordinary loads there', () => {
    expect(typesOffered('loads')).toEqual(['udl', 'trapezoidal', 'concentrated', 'temperature']);
  });

  it('offers it in the influence workspace', () => {
    expect(typesOffered('influence')).toContain('concentrated_deformation');
  });
});
