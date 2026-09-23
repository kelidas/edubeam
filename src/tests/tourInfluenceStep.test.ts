import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as directives from 'vuetify/directives';
import * as components from 'vuetify/components';
import { i18n } from '@/plugins/i18n';
import HelloWorld from '@/components/HelloWorld.vue';

/**
 * "Influence lines" names the tab but not the method behind it, and the kinematic method is the
 * whole of the workspace: release the section with a unit deformation and read the deflected shape.
 * A step of the tour says so, pointing at the tab - which it finds by the id the tab carries, so
 * renaming that id quietly leaves the step pointing at nothing.
 */
const tabs = () =>
  mount(HelloWorld, {
    global: {
      plugins: [createVuetify({ components, directives }), i18n],
      // the tab bar is what is under test; what each tab holds is drawn elsewhere
      stubs: { SVGViewer: true, Settings: true },
      config: { warnHandler: () => {} },
    },
  }).findAll('.v-tab');

describe('the tab the tour points at', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('is there to be found by the id the step attaches to', () => {
    expect(tabs().map((tab) => tab.attributes('id'))).toContain('tab-influence');
  });

  it('names every tab that opens a workspace, and only those', () => {
    expect(tabs().map((tab) => tab.attributes('id'))).toEqual(['tab-viewer', 'tab-influence', 'tab-settings']);
  });

  it('has something to say about it in both languages that are kept up to date', () => {
    // the messages are compiled, so they are read the way the app reads them rather than as data
    const was = i18n.global.locale.value;

    for (const locale of ['en', 'cs']) {
      i18n.global.locale.value = locale;

      expect(i18n.global.t('tour.influence.title'), locale).not.toBe('tour.influence.title');
      expect(i18n.global.t('tour.influence.description'), locale).toMatch(/kinematic|kinematick/);
    }

    i18n.global.locale.value = was;
  });
});
