import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { DofID } from 'ts-fem';
import { useAppStore } from '@/store/app';
import { useProjectStore } from '@/store/project';

/**
 * Every diagram is scaled to the largest value in the load case being drawn. Changing workspace
 * changes the case, so the scale has to change with it in the same breath: a throttled re-solve
 * arrives a frame late, and in that frame an influence line of order one is drawn at the scale of a
 * structure that deflects by millimetres - tens of thousands of pixels off screen, and then pulled
 * back into the picture.
 */
const build = () => {
  const projectStore = useProjectStore();
  const domain = projectStore.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e-3 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [4, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');

  // a load whose deflection is millimetres, and a unit release whose "deflection" is of order one
  projectStore.solver.loadCases[0].createBeamElementUniformEdgeLoad('b', [0, 1000], true);
  projectStore.influenceLoadCase().createBeamConcentratedDeformation('b', [0, 0, 1, 2], true);

  return projectStore;
};

const workspaceTab = (id: 'viewer' | 'influence') => {
  const appStore = useAppStore();

  appStore.tab = appStore.tabs.findIndex((t) => t.props.id === id);
  expect(appStore.workspace).toBe(id === 'influence' ? 'influence' : 'loads');
};

describe('the scale a diagram is drawn at', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('belongs to the workspace on screen by the time it is drawn', async () => {
    const projectStore = build();

    workspaceTab('viewer');
    projectStore.solveNow();

    const onStructure = projectStore.defoScale;

    expect(onStructure).toBeGreaterThan(0);

    // changing tab and letting Vue render: the scale has to be the new case's before that render
    workspaceTab('influence');
    await nextTick();

    expect(projectStore.defoScale).not.toBe(onStructure);
    // a unit release deflects by about one, so its scale is about one - not the hundreds a
    // structure deflecting by millimetres needs
    expect(projectStore.defoScale).toBeLessThan(10);
  });

  it('goes back with it', async () => {
    const projectStore = build();

    workspaceTab('influence');
    await nextTick();

    const onInfluence = projectStore.defoScale;

    workspaceTab('viewer');
    await nextTick();

    expect(projectStore.defoScale).not.toBe(onInfluence);
    expect(projectStore.defoScale).toBeGreaterThan(10);
  });
});
