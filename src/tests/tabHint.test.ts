import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as directives from 'vuetify/directives';
import * as components from 'vuetify/components';
import { VTooltip } from 'vuetify/components';
import { i18n } from '@/plugins/i18n';
import HelloWorld from '@/components/HelloWorld.vue';
import { useAppStore } from '@/store/app';

/**
 * "Influence lines" names the tab but does not say how the app draws them, and the kinematic method
 * is the whole point of the workspace: release the section, read the deflected shape. The tab says
 * so itself rather than leaving it to be discovered.
 */
const tabs = () =>
  mount(HelloWorld, {
    global: {
      plugins: [createVuetify({ components, directives }), i18n],
      // the tab bar is what is under test; what each tab holds is drawn elsewhere
      stubs: { SVGViewer: true, Settings: true },
      config: { warnHandler: () => {} },
    },
  }).findAllComponents({ name: 'VTab' });

describe('the tab bar', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('tells the reader what the influence tab is for', () => {
    const influence = useAppStore().tabs.findIndex((t) => t.props.id === 'influence');
    const tooltip = tabs()[influence].findComponent(VTooltip);

    expect(tooltip.exists()).toBe(true);
    // the tooltip only renders its text once it opens, so read what it was given to show
    expect(tooltip.props('text')).toContain('kinematic');
  });

  it('leaves the tabs whose name says it alone', () => {
    const viewer = useAppStore().tabs.findIndex((t) => t.props.id === 'viewer');

    expect(tabs()[viewer].findComponent(VTooltip).exists()).toBe(false);
  });

  it('has a line for every tab that asks for one', () => {
    const missing = useAppStore()
      .tabs.filter((tab) => tab.hint)
      .filter((tab) => i18n.global.t(tab.hint!) === tab.hint);

    expect(missing).toEqual([]);
  });
});
