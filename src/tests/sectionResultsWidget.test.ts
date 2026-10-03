import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';
import SectionResults from '@/components/SectionResults.vue';
import { axisConvention } from '@/utils/axisConvention';

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

  it('thins the labels out once they would sit on top of one another, rather than dropping them all', async () => {
    build();
    const w = widget();

    await w.findComponent({ name: 'VTextField' }).setValue(40);

    expect(w.findAll('svg circle.ordinate')).toHaveLength(41);

    const kept = w
      .findAll('svg text.ordinate')
      .map((t) => ({ x: Number(t.attributes('x')), y: Number(t.attributes('y')) }));

    expect(kept.length).toBeGreaterThan(1);
    expect(kept.length).toBeLessThan(41);
    // what is kept stands apart: no two numbers written over each other, near across and on one line
    kept.forEach((a, i) =>
      kept.slice(i + 1).forEach((b) => expect(Math.abs(a.x - b.x) > 20 || Math.abs(a.y - b.y) >= 11).toBe(true))
    );
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
 * The influence line workspace is work of its own, and this branch does not carry it: without it
 * there is one load case and the widget reads that. Where it is present, which results the widget
 * shows has to follow the workspace on screen, because the widget floats above both tabs rather
 * than living in one.
 */
const hasWorkspaces = () => {
  try {
    setActivePinia(createPinia());

    return 'workspace' in useAppStore();
  } catch {
    return false;
  }
};

describe.runIf(hasWorkspaces())('which load case the widget reads', () => {
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
    // the shear steps with the load; it has no stationary point in between
    await w.find('.v-btn-toggle button[data-quantity="vz"]').trigger('click');

    expect(w.findAll('svg circle.turn')).toHaveLength(0);
  });
});

/**
 * A value at a jump is the point of a jump: the shear before a load and the shear after it are two
 * readings and both are wanted, so they are written before anything else on the diagram is.
 */
describe('the numbers at a jump', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const withForce = (at: number, force: number) => {
    const store = build();

    store.solver.loadCases[0].createBeamConcentratedLoad('b', [0, force, 0, at], true);
    store.solve();

    return store;
  };

  const draw = async (w: ReturnType<typeof widget>, quantity: string) => {
    await w.find(`.v-btn-toggle button[data-quantity="${quantity}"]`).trigger('click');
  };

  it('writes both sides of a step, not one of them', async () => {
    withForce(2.5, 9000);
    const w = widget();

    await draw(w, 'vz');
    const written = w.findAll('svg text.jump').map((t) => t.text());

    expect(written).toHaveLength(2);
    expect(written[0]).not.toBe(written[1]);
  });

  it('sets the two apart, one either side of the ordinate', async () => {
    withForce(2.5, 9000);
    const w = widget();

    await draw(w, 'vz');
    const anchors = w.findAll('svg text.jump').map((t) => t.attributes('text-anchor'));

    expect(anchors).toEqual(['end', 'start']);
  });

  it('keeps them when the sections are too many to label', async () => {
    withForce(2.5, 9000);
    const w = widget();

    await draw(w, 'vz');
    await w.findAllComponents({ name: 'VTextField' })[0].setValue(40);

    // the regular sections give some of their labels up, the jump does not
    expect(w.findAll('svg text.ordinate').length).toBeLessThan(41);
    expect(w.findAll('svg text.jump')).toHaveLength(2);
  });

  it('keeps the sections either side of it when there is room for them', async () => {
    withForce(2.5, 9000);
    const w = widget();

    await draw(w, 'vz');
    // four pieces of a six metre beam: the neighbours of the step are half a metre from it
    await w.findAllComponents({ name: 'VTextField' })[0].setValue(4);

    const at = (metres: number) =>
      w.findAll('svg text.ordinate').filter((t) => Math.abs(Number(t.attributes('x')) - (10 + (300 * metres) / 6)) < 4);

    expect(at(1.5)).toHaveLength(1);
    expect(at(3)).toHaveLength(1);
    expect(w.findAll('svg text.jump')).toHaveLength(2);
  });
});

/**
 * An imposed deformation is how an influence line is drawn: it steps the deflection and leaves the
 * internal forces whole. Writing two numbers at its distance on a moment diagram - ahead of
 * everything else, and at the cost of a neighbour - says a jump is there when none is.
 */
describe('a jump that only one quantity has', () => {
  beforeEach(() => setActivePinia(createPinia()));

  const withDislocation = (at: number) => {
    const store = build();

    store.solver.loadCases[0].createBeamConcentratedDeformation('b', [0, 0.01, 0, at], true);
    store.solve();

    return store;
  };

  const draw = async (w: ReturnType<typeof widget>, quantity: string) => {
    await w.find(`.v-btn-toggle button[data-quantity="${quantity}"]`).trigger('click');
  };

  // clear of midspan, where the peak of both the moment and the deflection wants the same room
  it('writes both numbers on the deflection, where the step is', async () => {
    withDislocation(1);
    const w = widget();

    await draw(w, 'w');

    expect(w.findAll('svg text.jump')).toHaveLength(2);
  });

  it('writes none on the moment, where there is no step', async () => {
    withDislocation(1);
    const w = widget();

    await draw(w, 'my');

    expect(w.findAll('svg text.jump')).toHaveLength(0);
  });

  it('never writes two numbers where nothing steps', async () => {
    withDislocation(1);
    const w = widget();

    await draw(w, 'my');
    const here = w
      .findAll('svg text.ordinate, svg text.jump')
      .filter((t) => Math.abs(Number(t.attributes('x')) - (10 + (320 - 20) / 6)) < 6);

    // one number, or none if a neighbouring section is too close for it - never the pair
    expect(here.length).toBeLessThanOrEqual(1);
  });

  it('still lists both rows in the table, which is where the deflection differs', async () => {
    withDislocation(1);
    const w = widget();

    const pairs = bodyRows(w).filter((r) => /[−+]/.test(r.find('th').text()));

    expect(pairs).toHaveLength(2);
  });
});

/**
 * The table is read in the system the reader chose, not in the one the solver works in. Turning the
 * vertical axis over turns the quantities that point along it - the deflection across the beam and
 * the shear that goes with it - and leaves the moment and the rotation, which both systems count
 * the same way. The headings carry the letters of whichever system is on.
 */
describe('the coordinate system the numbers are read in', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => (axisConvention.value = 'z-down'));

  const headings = () =>
    widget()
      .findAll('thead th')
      .map((th) => th.text().replace(/\s*\[.*/, ''));

  /** A section with something of everything: away from the ends, where all six are non-zero. */
  const section = () =>
    bodyRows(widget())[1]
      .findAll('td')
      .map((td) => td.text());

  it('names the columns after the axes in use', () => {
    build();

    expect(headings()).toEqual(['x', 'N', 'Vz', 'My', 'ux', 'uz', 'φ']);

    axisConvention.value = 'y-up';

    expect(headings()).toEqual(['x', 'N', 'Vy', 'Mz', 'ux', 'uy', 'φ']);
  });

  it('turns the deflection and the shear over with the axis, and nothing else', () => {
    build();

    const [n, vz, my, u, w, phi] = section();

    axisConvention.value = 'y-up';
    const [upN, upVz, upMy, upU, upW, upPhi] = section();

    expect(upVz).not.toBe(vz);
    expect(upW).not.toBe(w);
    expect([upN, upMy, upU, upPhi]).toEqual([n, my, u, phi]);
  });
});
