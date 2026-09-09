import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
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

    expect(headers).toHaveLength(6);
    expect(headers[0]).toContain('[m]');
    // force, force, moment, length, length, in the units the app is set to
    expect(headers[1]).toContain('[kN]');
    expect(headers[3]).toContain('[kNm]');
    expect(headers[5]).toContain('[m]');
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
