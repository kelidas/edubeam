import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { DofID } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { useClipboardStore } from '@/store/clipboard';
import { undoModelChange } from '@/utils';

/**
 * Moving is pasting that puts down the originals instead of a copy: the same pick-up, the same
 * carrying under the pointer, the same typed offset. These hold it to moving and to nothing more.
 */
const frame = () => {
  const store = useProjectStore();
  const domain = store.solver.domain;

  domain.createMaterial('m', { e: 210e9, g: 81e9, alpha: 1.2e-5, d: 7850 });
  domain.createCrossSection('cs', { a: 1e-2, iy: 1e-5, h: 0.2, k: 1e6 });
  domain.createNode('1', [0, 0, 0], [DofID.Dx, DofID.Dz]);
  domain.createNode('2', [4, 0, 0], []);
  domain.createNode('3', [8, 0, 0], [DofID.Dz]);
  domain.createBeam2D('a', ['1', '2'], 'm', 'cs');
  domain.createBeam2D('b', ['2', '3'], 'm', 'cs');

  return store;
};

const selecting = (over: Partial<Record<'nodes' | 'elements' | 'dimensions', string[]>>) => ({
  nodes: [],
  elements: [],
  nodalLoads: [],
  elementLoads: [],
  prescribedBC: [],
  dimensions: [],
  ...over,
});

const at = (store: ReturnType<typeof useProjectStore>, label: string) => {
  const node = store.solver.domain.nodes.get(label)!;

  return [node.coords[0], node.coords[2]];
};

describe('moving a selection', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('moves the selected nodes by the offset, and adds nothing', () => {
    const store = frame();
    const clipboard = useClipboardStore();

    clipboard.select(selecting({ nodes: ['2'] }), 'move');
    clipboard.move({ x: 0, z: -1 });

    expect(at(store, '2')).toEqual([4, -1]);
    expect(store.solver.domain.nodes.size).toBe(3);
    expect(store.solver.domain.elements.size).toBe(2);
  });

  it('takes the ends of a selected element with it', () => {
    const store = frame();
    const clipboard = useClipboardStore();

    clipboard.select(selecting({ elements: ['b'] }), 'move');
    clipboard.move({ x: 1, z: 2 });

    // both ends of b, and 1 - which only a belongs to - stays
    expect(at(store, '2')).toEqual([5, 2]);
    expect(at(store, '3')).toEqual([9, 2]);
    expect(at(store, '1')).toEqual([0, 0]);
  });

  it('moves a node shared by two selected elements once, not twice', () => {
    const store = frame();
    const clipboard = useClipboardStore();

    clipboard.select(selecting({ nodes: ['2'], elements: ['a', 'b'] }), 'move');
    clipboard.move({ x: 1, z: 0 });

    expect(at(store, '2')).toEqual([5, 0]);
  });

  it('keeps what hangs off the nodes - supports and loads', () => {
    const store = frame();
    const clipboard = useClipboardStore();

    store.solver.loadCases[0].createNodalLoad('2', { [DofID.Dz]: 1000 });
    clipboard.select(selecting({ nodes: ['1', '2'] }), 'move');
    clipboard.move({ x: 3, z: 0 });

    expect([...store.solver.domain.nodes.get('1')!.bcs]).toEqual([DofID.Dx, DofID.Dz]);
    expect(store.solver.loadCases[0].nodalLoadList).toHaveLength(1);
    expect(store.solver.loadCases[0].nodalLoadList[0].target).toBe('2');
  });

  it('moves a freely placed dimension with it, and leaves one measured from a node to its node', () => {
    const store = frame();
    const clipboard = useClipboardStore();

    store.dimensions.push(
      {
        id: 'free',
        distance: 1,
        points: [
          { x: 0, y: 0, sourceNodeLabel: null },
          { x: 4, y: 0, sourceNodeLabel: null },
        ],
      },
      {
        id: 'tied',
        distance: 1,
        points: [
          { x: 0, y: 0, sourceNodeLabel: '1' },
          { x: 4, y: 0, sourceNodeLabel: '2' },
        ],
      }
    );

    clipboard.select(selecting({ nodes: ['1', '2'], dimensions: ['free', 'tied'] }), 'move');
    clipboard.move({ x: 0, z: 5 });

    expect(store.dimensions[0].points.map((p) => p.y)).toEqual([5, 5]);
    // the node's own coordinates carry it; its stored point is not moved a second time
    expect(store.dimensions[1].points.map((p) => p.y)).toEqual([0, 0]);
  });

  it('lets go of what it moved, so the next paste does not move it again', () => {
    frame();
    const clipboard = useClipboardStore();

    clipboard.select(selecting({ nodes: ['2'] }), 'move');
    clipboard.move({ x: 1, z: 0 });

    expect(clipboard.isAnythingInClipboard()).toBe(false);
    expect(clipboard.mode).toBe('copy');
  });

  it('is one step to undo', () => {
    const store = frame();
    const clipboard = useClipboardStore();

    clipboard.select(selecting({ elements: ['a', 'b'] }), 'move');
    clipboard.move({ x: 2, z: 2 });
    undoModelChange();

    expect(at(store, '1')).toEqual([0, 0]);
    expect(at(store, '2')).toEqual([4, 0]);
    expect(at(store, '3')).toEqual([8, 0]);
  });

  it('leaves copying as it was', () => {
    const store = frame();
    const clipboard = useClipboardStore();

    clipboard.select(selecting({ elements: ['a'] }));
    clipboard.paste({ x: 0, z: 3 });

    expect(clipboard.mode).toBe('copy');
    expect(store.solver.domain.elements.size).toBe(3);
    expect(at(store, '1')).toEqual([0, 0]);
  });
});
