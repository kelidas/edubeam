import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { i18n } from '@/plugins/i18n';
import SVGViewer from '@/components/SVGViewer.vue';
import { useProjectStore } from '@/store/project';
import { useViewerStore } from '@/store/viewer';

/**
 * A mouse notch and a touchpad swipe are the same event carrying very different numbers: one notch
 * reads about a hundred, a swipe is a stream of ones and twos. A step per event let a single flick
 * of a touchpad run through a dozen of them, so the step follows the distance the wheel reports.
 */
const build = () => {
  const domain = useProjectStore().solver.domain;

  domain.createNode(1, [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode(2, [4, 0, 0], [DofID.Dz]);
  domain.createMaterial(1, { e: 210000e6, g: 8.75e10, alpha: 12e-6, d: 4000 });
  domain.createCrossSection(1, { a: 1, iy: 8.356e-5, iz: 1, dyz: 999991, h: 1, k: 1e32, j: 99999 });
  domain.createBeam2D(1, [1, 2], 1, 1);
};

const viewerWithScaleRows = () => {
  build();

  const results = useViewerStore().resultsFor('viewer');

  results.showScalePanel = true;
  results.showBendingMoment = true;

  const wrapper = mount(SVGViewer, {
    props: { id: 'viewer' },
    global: {
      plugins: [createVuetify({ directives }), i18n],
      config: { warnHandler: () => {} },
    },
  });

  return { wrapper, results };
};

/** The row for the bending moment, which the panel shows because the diagram is on. */
const momentRow = (wrapper: ReturnType<typeof mount>) => {
  const rows = wrapper.findAll('#resultScales > div');

  return rows[rows.length - 1];
};

describe('scaling a result diagram with the wheel', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('takes a quarter up for one notch of a mouse wheel', async () => {
    const { wrapper, results } = viewerWithScaleRows();

    await momentRow(wrapper).trigger('wheel', { deltaY: -100, deltaMode: 0 });

    expect(results.resultScale.bendingMoment).toBeCloseTo(1.25, 9);
  });

  it('takes a quarter down for a notch the other way', async () => {
    const { wrapper, results } = viewerWithScaleRows();

    await momentRow(wrapper).trigger('wheel', { deltaY: 100, deltaMode: 0 });

    expect(results.resultScale.bendingMoment).toBeCloseTo(1 / 1.25, 9);
  });

  it('barely moves for one event of a touchpad swipe', async () => {
    const { wrapper, results } = viewerWithScaleRows();

    await momentRow(wrapper).trigger('wheel', { deltaY: -3, deltaMode: 0 });

    expect(results.resultScale.bendingMoment).toBeGreaterThan(1);
    expect(results.resultScale.bendingMoment).toBeLessThan(1.02);
  });

  it('lands in the same place whether the distance came in one event or many', async () => {
    const { wrapper, results } = viewerWithScaleRows();

    for (let i = 0; i < 20; i++) await momentRow(wrapper).trigger('wheel', { deltaY: -5, deltaMode: 0 });

    // twenty small events of a swipe cover one notch between them, so they are worth one notch
    expect(results.resultScale.bendingMoment).toBeCloseTo(1.25, 6);
  });

  it('reads a wheel that reports lines rather than pixels', async () => {
    const { wrapper, results } = viewerWithScaleRows();

    // deltaMode 1 counts lines; a notch of about six of them is the same notch
    await momentRow(wrapper).trigger('wheel', { deltaY: -6.25, deltaMode: 1 });

    expect(results.resultScale.bendingMoment).toBeCloseTo(1.25, 9);
  });

  it('does not run away on one very large event', async () => {
    const { wrapper, results } = viewerWithScaleRows();

    await momentRow(wrapper).trigger('wheel', { deltaY: -100000, deltaMode: 0 });

    expect(results.resultScale.bendingMoment).toBeCloseTo(1.25 ** 3, 6);
  });

  it('stays within the limits the buttons keep to', async () => {
    const { wrapper, results } = viewerWithScaleRows();

    for (let i = 0; i < 60; i++) await momentRow(wrapper).trigger('wheel', { deltaY: -300, deltaMode: 0 });

    expect(results.resultScale.bendingMoment).toBe(1e3);
  });
});
