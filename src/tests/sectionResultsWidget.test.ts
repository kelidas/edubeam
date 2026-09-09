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

  it('names the node at each end, which is where x is measured from', () => {
    build();
    const names = widget()
      .findAll('svg text.node')
      .map((t) => t.text());

    expect(names).toEqual(['1', '2']);
  });

  it('marks every section the table lists, and labels it', () => {
    build();
    const w = widget();

    // nine sections, each with an ordinate and a dot
    expect(w.findAll('svg circle.ordinate')).toHaveLength(9);
    // the one at midspan gives its label up to the peak, which lands all but on top of it
    expect(w.findAll('svg text.ordinate')).toHaveLength(8);
    expect(w.findAll('svg text.turn')).toHaveLength(1);
  });

  it('drops the labels once they would sit on top of one another', async () => {
    build();
    const w = widget();

    await w.findComponent({ name: 'VTextField' }).setValue(40);

    expect(w.findAll('svg circle.ordinate')).toHaveLength(41);
    expect(w.findAll('svg text.ordinate')).toHaveLength(0);
  });

  it('writes a value that is only numerical noise as zero', () => {
    build();
    const w = widget();
    const ends = w.findAll('svg text.ordinate').map((t) => t.text());

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

/**
 * Without a step the pointer moved by a pixel of the diagram, so how finely a beam could be read
 * depended on how wide the window was - and the positions it gave were readings of the screen.
 */
describe('where the pointer may stop', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const fields = (w: ReturnType<typeof widget>) => w.findAllComponents({ name: 'VTextField' });

  const pointAt = async (w: ReturnType<typeof widget>, fraction: number) => {
    const svg = w.find('svg');

    // happy-dom lays nothing out, so the diagram's own box is what the reading is taken from
    svg.element.getBoundingClientRect = () => ({ left: 0, width: 320 }) as DOMRect;
    await svg.trigger('pointermove', { clientX: 10 + (320 - 20) * fraction });

    return Number(fields(w)[1].props('modelValue'));
  };

  it('stops on whole steps', async () => {
    build();
    const w = widget();

    // one piece, so the ends are the only sections and none of them is near the middle of the beam
    await fields(w)[0].setValue(1);
    const at = await pointAt(w, 0.37);

    // 2.22 m of this six metre beam: a centimetre to begin with
    expect(at).toBeCloseTo(2.22, 9);
  });

  it('follows the step it is given', async () => {
    build();
    const w = widget();

    await fields(w)[0].setValue(1);
    await fields(w)[2].setValue(0.5);
    const at = await pointAt(w, 0.37);

    // the same place, now to the nearest half metre
    expect(at).toBeCloseTo(2, 9);
  });

  it('lands on the sections the table lists, which no whole step need reach', async () => {
    build();
    const w = widget();

    // an eighth of this six metre beam is 0.75 m, and a third of the span is nearest to 2.25
    const at = await pointAt(w, 0.375);

    expect(at).toBeCloseTo(2.25, 9);
  });

  it('reaches both ends exactly', async () => {
    build();
    const w = widget();

    expect(await pointAt(w, -0.4)).toBe(0);
    expect(await pointAt(w, 1.4)).toBe(L);
  });

  it('takes a distance typed in as it is written', async () => {
    build();
    const w = widget();

    await fields(w)[1].setValue(1.2345);

    // the step is for the pointer; a number written by hand is a number meant exactly
    expect(bodyRows(w)[0].find('th').text()).toContain('1.2345');
  });
});

describe('where the drawn quantity turns', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const fields = (w: ReturnType<typeof widget>) => w.findAllComponents({ name: 'VTextField' });

  const pointAt = async (w: ReturnType<typeof widget>, fraction: number) => {
    const svg = w.find('svg');

    svg.element.getBoundingClientRect = () => ({ left: 0, width: 320 }) as DOMRect;
    await svg.trigger('pointermove', { clientX: 10 + (320 - 20) * fraction });

    return Number(fields(w)[1].props('modelValue'));
  };

  it('marks the peak of the moment', () => {
    build();

    // one peak on a simply supported beam under a uniform load
    expect(widget().findAll('svg circle.turn')).toHaveLength(1);
  });

  it('stops there, even when no division lands on it', async () => {
    build();
    const w = widget();

    // five pieces of a six metre beam: 1.2, 2.4, 3.6, 4.8 - and the peak is at 3
    await fields(w)[0].setValue(5);

    expect(await pointAt(w, 0.503)).toBeCloseTo(3, 6);
  });

  it('marks nothing where the quantity does not turn', async () => {
    build();
    const w = widget();
    const toggle = w.findAll('.v-btn-toggle button');

    // the shear steps with the load; it has no stationary point in between
    await toggle.find((b) => b.text() === 'V')!.trigger('click');

    expect(w.findAll('svg circle.turn')).toHaveLength(0);
  });
});
