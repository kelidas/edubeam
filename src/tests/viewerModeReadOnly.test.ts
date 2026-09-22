import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';
import { useClipboardStore } from '@/store/clipboard';
import { executeModelMutationWithUndo } from '@/utils';

/**
 * Viewer mode is reached by a link an author hands out, usually in an iframe, and is for showing a
 * model rather than changing one. Every edit in the app - a dialog, a key, a menu, a drag that has
 * finished - ends at `executeModelMutationWithUndo`, so that is where the promise is kept. Guarding
 * each affordance instead leaves whatever was forgotten, and everything was.
 */
const model = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [4, 0, 0], [DofID.Dz]);
  domain.createBeam2D('b', ['1', '2'], 'm', 'cs');

  return store;
};

const selecting = (over: Record<string, string[]>) => ({
  nodes: [],
  elements: [],
  nodalLoads: [],
  elementLoads: [],
  prescribedBC: [],
  dimensions: [],
  ...over,
});

describe('viewer mode', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('lets a model be changed when it is off', () => {
    const store = model();

    executeModelMutationWithUndo(() => store.solver.domain.createNode('3', [8, 0, 0], []));

    expect(store.solver.domain.nodes.size).toBe(3);
  });

  it('turns every edit into nothing when it is on', () => {
    const store = model();

    useAppStore().inViewerMode = true;
    executeModelMutationWithUndo(() => store.solver.domain.createNode('3', [8, 0, 0], []));

    expect(store.solver.domain.nodes.size).toBe(2);
  });

  it('stops a delete of the selection', () => {
    const store = model();

    useAppStore().inViewerMode = true;
    store.selection2.elements = ['b'];
    store.deleteSelection2();

    expect(store.solver.domain.elements.size).toBe(1);
  });

  it('stops a paste', () => {
    const store = model();
    const clipboard = useClipboardStore();

    useAppStore().inViewerMode = true;
    clipboard.select(selecting({ elements: ['b'] }));
    clipboard.paste({ x: 0, z: 3 });

    expect(store.solver.domain.nodes.size).toBe(2);
  });
});

describe('what the viewer still offers', () => {
  const VIEWER = readFileSync(join(process.cwd(), 'src/components/SVGViewer.vue'), 'utf-8');

  const bodyOf = (name: string) => {
    const at = VIEWER.indexOf(name);

    expect(at, name).toBeGreaterThan(-1);

    return VIEWER.slice(at, at + 400);
  };

  it('opens no context menu, whose entries all add, edit or delete', () => {
    expect(bodyOf('const openCtxMenu = ')).toContain('isReadOnly()');
  });

  it('picks nothing up to drag', () => {
    expect(bodyOf('MouseMode.HOVER && ')).toContain('isReadOnly()');
  });

  it('answers no shortcut that would change the model', () => {
    expect(bodyOf('const isShortcutBlocked = ')).toContain('isReadOnly()');
  });
});
