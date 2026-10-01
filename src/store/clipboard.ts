import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { useProjectStore } from './project';
import {
  Beam2D,
  BeamConcentratedLoad,
  BeamConcentratedDeformation,
  BeamElementTrapezoidalEdgeLoad,
  BeamElementUniformEdgeLoad,
  BeamTemperatureLoad,
  type NodalLoad,
  type PrescribedDisplacement,
} from 'ts-fem';
import { copyNode, executeModelMutationWithUndo, setUnsolved } from '@/utils';

type Selection = {
  nodes: string[];
  elements: string[];
  nodalLoads: number[];
  elementLoads: number[];
  prescribedBC: number[];
  dimensions: string[];
};

/**
 * A copied load, taken by value. The selection names loads by their index in the load list, and
 * those indices shift as soon as any load is deleted, so they cannot be kept until the paste.
 */
type CopiedLoad =
  | { kind: 'nodal'; target: string; values: NodalLoad['values'] }
  | { kind: 'prescribed'; target: string; values: PrescribedDisplacement['prescribedValues'] }
  | { kind: 'concentrated' | 'uniform' | 'concentrated_deformation'; target: string; values: number[]; lcs: boolean }
  | { kind: 'trapezoidal'; target: string; startValues: [number, number]; endValues: [number, number]; lcs: boolean }
  | { kind: 'temperature'; target: string; values: number[] };

const cloneClipboardValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneClipboardValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneClipboardValue(entry)])) as T;
  }

  return value;
};

const copyElementLoad = (l: unknown): CopiedLoad | null => {
  if (l instanceof BeamConcentratedLoad) {
    return { kind: 'concentrated', target: String(l.target), values: cloneClipboardValue(l.values), lcs: l.lcs };
  }
  if (l instanceof BeamConcentratedDeformation) {
    return {
      kind: 'concentrated_deformation',
      target: String(l.target),
      values: cloneClipboardValue(l.values),
      lcs: l.lcs,
    };
  }
  if (l instanceof BeamElementUniformEdgeLoad) {
    return { kind: 'uniform', target: String(l.target), values: cloneClipboardValue(l.values), lcs: l.lcs };
  }
  if (l instanceof BeamElementTrapezoidalEdgeLoad) {
    return {
      kind: 'trapezoidal',
      target: String(l.target),
      startValues: cloneClipboardValue(l.startValues) as [number, number],
      endValues: cloneClipboardValue(l.endValues) as [number, number],
      lcs: l.lcs,
    };
  }
  if (l instanceof BeamTemperatureLoad) {
    return { kind: 'temperature', target: String(l.target), values: cloneClipboardValue(l.values) };
  }

  return null;
};

export const useClipboardStore = defineStore('clipboard', () => {
  const copied = reactive<{ nodes: string[]; elements: string[]; loads: CopiedLoad[]; dimensions: string[] }>({
    nodes: [],
    elements: [],
    loads: [],
    dimensions: [],
  });

  /**
   * Nodes and elements stay references into the model, so the paste preview can draw them. Anything
   * deleted since the copy (or undone away) drops out here rather than being pasted from nothing.
   */
  const nodes = computed(() => copied.nodes.filter((label) => useProjectStore().solver.domain.nodes.has(label)));
  const elements = computed(() =>
    copied.elements.filter((label) => useProjectStore().solver.domain.elements.has(label))
  );

  /**
   * Whether what is held is to be copied or moved when it is placed.
   *
   * The two are one gesture - pick up a selection, carry it under the pointer, put it down - and
   * differ only in what putting it down does, so they share the placing mode, its preview and its
   * typed offset rather than each having their own.
   */
  const mode = ref<'copy' | 'move'>('copy');

  const select = (sel: Selection, as: 'copy' | 'move' = 'copy') => {
    mode.value = as;

    const loadCase = useProjectStore().loadCase;

    copied.nodes = sel.nodes.map(String);
    copied.elements = sel.elements.map(String);
    copied.dimensions = [...sel.dimensions];
    copied.loads = [
      ...sel.nodalLoads
        .map((i) => loadCase.nodalLoadList[i])
        .filter(Boolean)
        .map((l): CopiedLoad => ({ kind: 'nodal', target: String(l.target), values: cloneClipboardValue(l.values) })),
      ...sel.prescribedBC
        .map((i) => loadCase.prescribedBC[i])
        .filter(Boolean)
        .map((l): CopiedLoad => ({
          kind: 'prescribed',
          target: String(l.target),
          values: cloneClipboardValue(l.prescribedValues),
        })),
      ...sel.elementLoads.map((i) => copyElementLoad(loadCase.elementLoadList[i])).filter(Boolean),
    ];
  };

  const paste = (d: { x: number; z: number } = { x: 0, z: 0 }) => {
    executeModelMutationWithUndo(() => {
      const projectStore = useProjectStore();
      const domain = projectStore.solver.domain;
      const loadCase = projectStore.loadCase;
      setUnsolved();
      const nodeMap = new Map<string, string>();
      const elMap = new Map<string, string>();

      for (const node of nodes.value) {
        nodeMap.set(node, copyNode(domain.nodes.get(node), d));
      }

      for (const element of elements.value) {
        const e = domain.elements.get(element) as Beam2D;

        const endNodes = e.nodes.map((n) => {
          if (!nodeMap.has(n)) nodeMap.set(n, copyNode(domain.nodes.get(n), d));

          return nodeMap.get(n);
        });

        let newElId = domain.elements.size + 1;

        while (domain.elements.has(newElId.toString())) {
          newElId++;
        }

        elMap.set(element, newElId.toString());

        domain.createBeam2D(
          newElId.toString(),
          endNodes,
          e.mat,
          e.cs,
          cloneClipboardValue(e.hinges) as [boolean, boolean]
        );
      }

      // A load goes with its node or element; one copied without it has nowhere to land.
      for (const l of copied.loads) {
        const target = l.kind === 'nodal' || l.kind === 'prescribed' ? nodeMap.get(l.target) : elMap.get(l.target);
        if (target === undefined) continue;

        if (l.kind === 'nodal') loadCase.createNodalLoad(target, cloneClipboardValue(l.values));
        else if (l.kind === 'prescribed') loadCase.createPrescribedDisplacement(target, cloneClipboardValue(l.values));
        else if (l.kind === 'concentrated') {
          loadCase.createBeamConcentratedLoad(target, cloneClipboardValue(l.values), l.lcs);
        } else if (l.kind === 'concentrated_deformation') {
          loadCase.createBeamConcentratedDeformation(target, cloneClipboardValue(l.values), l.lcs);
        } else if (l.kind === 'uniform') {
          loadCase.createBeamElementUniformEdgeLoad(target, cloneClipboardValue(l.values), l.lcs);
        } else if (l.kind === 'trapezoidal') {
          loadCase.createBeamElementTrapezoidalEdgeLoad(
            target,
            cloneClipboardValue(l.startValues),
            cloneClipboardValue(l.endValues),
            l.lcs
          );
        } else loadCase.createBeamTemperatureLoad(target, cloneClipboardValue(l.values));
      }
    });
  };

  const midpoint = () => {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];

    const domain = useProjectStore().solver.domain;
    const labels = new Set([
      ...nodes.value,
      ...elements.value.flatMap((label) => (domain.elements.get(label) as Beam2D).nodes),
    ]);

    for (const label of labels) {
      const n = domain.nodes.get(label);
      if (!n) continue;

      min = [Math.min(min[0], n.coords[0]), Math.min(min[1], n.coords[1]), Math.min(min[2], n.coords[2])];
      max = [Math.max(max[0], n.coords[0]), Math.max(max[1], n.coords[1]), Math.max(max[2], n.coords[2])];
    }

    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  };

  const clear = () => {
    copied.nodes = [];
    copied.elements = [];
    copied.loads = [];
    copied.dimensions = [];
    mode.value = 'copy';
  };

  /**
   * Moves what is held by `d`, rather than copying it there.
   *
   * Only the nodes are moved - the selected ones and the ends of every selected element - since
   * everything else hangs off them: the elements between them, the loads on those, the loads and
   * supports on the nodes, and any dimension measured from a node. A dimension placed freely has
   * nothing to hang off, so its points are moved with the selection it belongs to.
   *
   * What was moved has been put down, so it is let go of: holding on would move it a second time
   * on the next paste.
   */
  const move = (d: { x: number; z: number } = { x: 0, z: 0 }) => {
    executeModelMutationWithUndo(() => {
      const projectStore = useProjectStore();
      const domain = projectStore.solver.domain;

      setUnsolved();

      const moved = new Set(nodes.value);

      for (const label of elements.value) {
        const element = domain.elements.get(label) as Beam2D | undefined;

        element?.nodes.forEach((node) => moved.add(node));
      }

      for (const label of moved) {
        const node = domain.nodes.get(label);

        if (!node) continue;

        node.coords[0] += d.x;
        node.coords[2] += d.z;
      }

      for (const dimension of projectStore.dimensions) {
        if (!dimension.id || !copied.dimensions.includes(dimension.id)) continue;

        for (const point of dimension.points) {
          // a point measured from a node goes wherever its node goes
          if (point.sourceNodeLabel !== null && point.sourceNodeLabel !== undefined) {
            if (domain.nodes.has(String(point.sourceNodeLabel))) continue;
          }

          point.x += d.x;
          point.y += d.z;
        }
      }
    });

    clear();
  };

  // Loads alone paste nothing, so only what they would ride on counts.
  const isAnythingInClipboard = () => nodes.value.length > 0 || elements.value.length > 0;

  return {
    nodes,
    elements,
    mode,
    select,
    paste,
    move,
    clear,
    midpoint,
    isAnythingInClipboard,
  };
});
