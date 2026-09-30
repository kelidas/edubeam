import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { i18n } from '@/plugins/i18n';
import HelloWorld from '@/components/HelloWorld.vue';
import { useAppStore } from '@/store/app';

/**
 * The influence-lines tab can be switched off in Settings, for whoever never needs it. It stays
 * in `appStore.tabs` and the case behind it stays in the model either way - only whether it is
 * rendered changes, through the item's own `v-if` rather than by shortening the tabs array, so a
 * fixed position keeps meaning the same tab whichever way the switch is set.
 */
const open = () => {
  const wrapper = mount(HelloWorld, {
    global: {
      plugins: [createVuetify({ components, directives }), i18n],
      stubs: { SVGViewer: true, Settings: true },
      config: { warnHandler: () => {} },
    },
  });

  return { wrapper, tabIds: () => wrapper.findAll('.v-tab').map((tab) => tab.attributes('id')) };
};

describe('switching the influence-lines tab off', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('is on by default', () => {
    expect(useAppStore().showInfluenceWorkspace).toBe(true);
  });

  it('removes the tab, and brings it back, without touching the others', async () => {
    const { tabIds } = open();
    const appStore = useAppStore();

    expect(tabIds()).toEqual(['tab-viewer', 'tab-influence', 'tab-settings']);

    appStore.showInfluenceWorkspace = false;
    await nextTick();

    expect(tabIds()).toEqual(['tab-viewer', 'tab-settings']);

    appStore.showInfluenceWorkspace = true;
    await nextTick();

    expect(tabIds()).toEqual(['tab-viewer', 'tab-influence', 'tab-settings']);
  });

  it('sends the reader back to the structure if the influence tab was the open one', async () => {
    open();
    const appStore = useAppStore();

    appStore.tab = appStore.tabs.findIndex((t) => t.props?.id === 'influence');
    await nextTick();
    expect(appStore.openedTab?.props?.id).toBe('influence');

    appStore.showInfluenceWorkspace = false;
    await nextTick();

    expect(appStore.openedTab?.props?.id).toBe('viewer');
  });

  it('leaves the reader on settings, which never moved', async () => {
    open();
    const appStore = useAppStore();

    appStore.tab = appStore.tabs.findIndex((t) => t.props?.id === 'settings');
    await nextTick();

    appStore.showInfluenceWorkspace = false;
    await nextTick();

    expect(appStore.openedTab?.props?.id).toBe('settings');
  });
});
