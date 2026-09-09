import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';
import SectionResults from '@/components/SectionResults.vue';

/**
 * The widget over the same simply supported beam the computation is checked on, so what the table
 * shows can be recognised: ql²/8 in the middle and nothing at the ends.
 */
const L = 6;
const Q = 2000;

const vuetify = createVuetify({ components, directives });

const build = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [L, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');
  store.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, Q], true);
  store.solve();

  return store;
};

const widget = () =>
  mount(SectionResults, {
    props: { label: 'b' },
    global: { plugins: [vuetify], mocks: { $t: (key: string) => key } },
  });

const bodyRows = (w: ReturnType<typeof widget>) => w.findAll('tbody tr');

describe('the section results widget', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('shows a row per section, ends included', () => {
    build();

    // the default is eight divisions, so nine sections
    expect(bodyRows(widget())).toHaveLength(9);
  });

  it('heads every column with the unit its numbers are in', () => {
    build();
    const headers = widget()
      .findAll('thead th')
      .map((th) => th.text());

    expect(headers).toHaveLength(7);
    expect(headers[0]).toContain('[m]');
    // force, force, moment, length, length, rotation, in the units the app is set to
    expect(headers[1]).toContain('[kN]');
    expect(headers[3]).toContain('[kNm]');
    expect(headers[5]).toContain('[m]');
    // a rotation has no unit the app converts
    expect(headers[6]).toContain('[rad]');
  });

  it('marks the largest moment in the middle of the span', () => {
    build();
    const rows = bodyRows(widget());

    // nine sections, so the middle one is the fifth
    expect(rows[4].findAll('td')[2].classes()).toContain('font-weight-bold');
    expect(rows[0].findAll('td')[2].classes()).not.toContain('font-weight-bold');
  });

  it('follows the division count', async () => {
    build();
    const w = widget();

    await w.findComponent({ name: 'VTextField' }).setValue(4);

    expect(bodyRows(w)).toHaveLength(5);
  });

  it('adds a row for a section asked for, above the rest', async () => {
    build();
    const w = widget();

    await w.findAllComponents({ name: 'VTextField' })[1].setValue(L / 4);
    const first = bodyRows(w)[0];

    // the quarter point is not one of the eighths shown, so it is a tenth row
    expect(bodyRows(w)).toHaveLength(10);
    expect(first.find('th').text()).toContain('1.5');
    // 3ql²/32, which is 6.75 kNm here - and not the 4.5 a chord through the eighths would give
    expect(first.findAll('td')[2].text()).toMatch(/6[.,]75/);
  });

  it('pulls a section past the end back onto the element', async () => {
    build();
    const w = widget();

    await w.findAllComponents({ name: 'VTextField' })[1].setValue(L + 10);

    expect(bodyRows(w)[0].find('th').text()).toContain('6');
  });

  it('says nothing is there before the structure is solved', () => {
    const store = build();
    store.solver.loadCases[0].solved = false;

    expect(widget().text()).toContain('common.notSolved');
  });
});

describe('what the widget draws', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('plots a curve of its own, far finer than the table it sits above', () => {
    build();
    const points = widget().find('polyline').attributes('points')!.split(' ');

    // the shape between the sections, not a chord through them: a table of four would otherwise
    // draw a parabola as four straight pieces
    expect(points.length).toBeGreaterThan(50);
  });

  it('marks every section the table lists, and labels it', () => {
    build();
    const w = widget();

    // nine sections, each with an ordinate and a dot
    expect(w.findAll('svg circle')).toHaveLength(9);
    expect(w.findAll('svg text').length).toBeGreaterThanOrEqual(9);
  });

  it('drops the labels once they would sit on top of one another', async () => {
    build();
    const w = widget();

    await w.findComponent({ name: 'VTextField' }).setValue(40);

    expect(w.findAll('svg circle')).toHaveLength(41);
    expect(w.findAll('svg text')).toHaveLength(0);
  });

  it('writes a value that is only numerical noise as zero', () => {
    build();
    const w = widget();
    const ends = w.findAll('svg text').map((t) => t.text());

    // the moment at both ends of a simply supported beam, which the solve leaves at about 1e-16
    expect(ends[0]).toBe('0');
    expect(ends[ends.length - 1]).toBe('0');
  });
});

/**
 * The widget floats above both tabs rather than living in one, so which results it reads has to
 * follow the workspace on screen: the real loads in the viewer, the unit dislocations whose
 * deflected shape is an influence line in the other.
 */
describe('which load case the widget reads', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const momentColumn = (w: ReturnType<typeof widget>) => bodyRows(w).map((row) => row.findAll('td')[2].text());

  it('reads the influence case in the influence workspace', async () => {
    const store = build();
    const app = useAppStore();
    const influence = store.influenceLoadCase();

    // a unit dislocation on the element, which is what an influence line is read from
    influence.createBeamConcentratedDeformation('b', [0, 1, 0], L / 2, true);
    store.solve();

    const w = widget();
    const loads = momentColumn(w);

    app.tab = app.tabs.findIndex((t) => t.props?.id === 'influence');
    await w.vm.$nextTick();

    expect(app.workspace).toBe('influence');
    expect(momentColumn(w)).not.toEqual(loads);
  });

  it('goes back to the loads when that tab is open', async () => {
    const store = build();
    const app = useAppStore();

    store.influenceLoadCase();
    store.solve();

    const w = widget();
    const loads = momentColumn(w);

    app.tab = app.tabs.findIndex((t) => t.props?.id === 'influence');
    await w.vm.$nextTick();
    app.tab = app.tabs.findIndex((t) => t.props?.id === 'viewer');
    await w.vm.$nextTick();

    expect(momentColumn(w)).toEqual(loads);
  });
});
