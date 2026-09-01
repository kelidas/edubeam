import { describe, it, expect, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { DofID, Beam2D } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';

const buildBeam = () => {
  const projectStore = useProjectStore();
  const domain = projectStore.solver.domain;

  domain.createNode(1, [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode(2, [4, 0, 0], [DofID.Dz]);
  domain.createMaterial(1, { e: 210000e6, g: 8.75e10, alpha: 12e-6, d: 4000 });
  domain.createCrossSection(1, { a: 1, iy: 8.356e-5, iz: 1, dyz: 999991, h: 1, k: 1e32, j: 99999 });
  domain.createBeam2D('1', [1, 2], 1, 1);

  return projectStore;
};

describe('influence line workspace', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('follows the open tab', async () => {
    const projectStore = buildBeam();
    const appStore = useAppStore();

    expect(appStore.workspace).toBe('loads');
    expect(projectStore.loadCase).toBe(projectStore.solver.loadCases[0]);

    appStore.tab = appStore.tabs.findIndex((t) => t.props?.id === 'influence');
    await nextTick();

    expect(appStore.workspace).toBe('influence');
    expect(projectStore.loadCase).toBe(projectStore.influenceLoadCase());
  });

  it('keeps the dislocations apart from the real loads', () => {
    const projectStore = buildBeam();
    const L = 4;
    const a = 1;

    // a real force in the first case, the Muller-Breslau unit rotation in the second
    projectStore.solver.loadCases[0].createBeamElementUniformEdgeLoad('1', [0, 1000], true);
    projectStore.influenceLoadCase().createBeamConcentratedDeformation('1', [0, 0, 1, a], true);

    projectStore.solve();

    const beam = projectStore.solver.domain.getElement('1') as Beam2D;
    const influence = beam.computeGlobalDefl(projectStore.influenceLoadCase(), 8);
    const loads = beam.computeGlobalDefl(projectStore.solver.loadCases[0], 8);

    // the influence line for M(a) on a simply supported beam, untouched by the force
    const b = L - a;
    for (let i = 0; i <= 8; i++) {
      const x = (L * i) / 8;
      const expected = x <= a ? (x * b) / L : (a * (L - x)) / L;
      expect(influence.w[i]).toBeCloseTo(expected, 5);
    }

    // and the force case is the plain deflection of a loaded beam, no dislocation in it
    expect(Math.max(...loads.w.map(Math.abs))).toBeGreaterThan(0);
    expect(Math.abs(loads.w[2] - influence.w[2])).toBeGreaterThan(1e-6);
  });

  it('validates the influence case too', () => {
    const projectStore = buildBeam();

    projectStore.influenceLoadCase().createBeamConcentratedDeformation('missing', [0, 0, 1, 1], true);
    projectStore.solve();

    expect(projectStore.solveDiagnostics.errors.some((e) => e.code === 'ELEMENT_LOAD_MISSING_TARGET')).toBe(true);
  });
});
