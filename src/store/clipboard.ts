import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { useProjectStore } from './project';
import {
  Beam2D,
  BeamConcentratedLoad,
  BeamElementTrapezoidalEdgeLoad,
  BeamElementUniformEdgeLoad,
  BeamTemperatureLoad,
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

const cloneClipboardValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((item) => cloneClipboardValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneClipboardValue(entry)])) as T;
  }

  return value;
};

export const useClipboardStore = defineStore('clipboard', () => {
  const selection = reactive<Selection>({
    nodes: [],
    elements: [],
    nodalLoads: [],
    elementLoads: [],
    prescribedBC: [],
    dimensions: [],
  });

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
    selection.nodes = [...sel.nodes];
    selection.elements = [...sel.elements];
    selection.nodalLoads = [...sel.nodalLoads];
    selection.elementLoads = [...sel.elementLoads];
    selection.prescribedBC = [...sel.prescribedBC];
    selection.dimensions = [...sel.dimensions];
  };

  const paste = (d: { x: number; z: number } = { x: 0, z: 0 }) => {
    executeModelMutationWithUndo(() => {
      const projectStore = useProjectStore();
      setUnsolved();
      const nodeMap = new Map<string, string>();
      const elMap = new Map<string, string>();

      for (const node of selection.nodes) {
        const n = projectStore.solver.domain.nodes.get(node);

        const newNodeId = copyNode(n, d);
        nodeMap.set(node, newNodeId.toString());
      }

      for (const element of selection.elements) {
        const e = projectStore.solver.domain.elements.get(element) as Beam2D;

        const nodes = e.nodes.map((n) => nodeMap.get(n) ?? copyNode(projectStore.solver.domain.nodes.get(n)!, d));

        let newElId = projectStore.solver.domain.elements.size + 1;

        while (projectStore.solver.domain.elements.has(newElId.toString())) {
          newElId++;
        }

        elMap.set(element, newElId.toString());

        projectStore.solver.domain.createBeam2D(
          newElId.toString(),
          nodes,
          e.mat,
          e.cs,
          cloneClipboardValue(e.hinges) as [boolean, boolean]
        );
      }

      for (const load of selection.nodalLoads) {
        const l = projectStore.solver.loadCases[0].nodalLoadList[load];
        projectStore.solver.loadCases[0].createNodalLoad(nodeMap.get(l.target)!, cloneClipboardValue(l.values));
      }

      for (const load of selection.prescribedBC) {
        const l = projectStore.solver.loadCases[0].prescribedBC[load];
        projectStore.solver.loadCases[0].createPrescribedDisplacement(
          nodeMap.get(l.target)!,
          cloneClipboardValue(l.prescribedValues)
        );
      }

      for (const load of selection.elementLoads) {
        const l = projectStore.solver.loadCases[0].elementLoadList[load];
        if (l instanceof BeamConcentratedLoad) {
          projectStore.solver.loadCases[0].createBeamConcentratedLoad(
            elMap.get(l.target)!,
            cloneClipboardValue(l.values),
            l.lcs
          );
        } else if (l instanceof BeamElementUniformEdgeLoad) {
          projectStore.solver.loadCases[0].createBeamElementUniformEdgeLoad(
            elMap.get(l.target)!,
            cloneClipboardValue(l.values),
            l.lcs
          );
        } else if (l instanceof BeamElementTrapezoidalEdgeLoad) {
          projectStore.solver.loadCases[0].createBeamElementTrapezoidalEdgeLoad(
            elMap.get(l.target)!,
            cloneClipboardValue(l.startValues) as [number, number],
            cloneClipboardValue(l.endValues) as [number, number],
            l.lcs
          );
        } else if (l instanceof BeamTemperatureLoad) {
          projectStore.solver.loadCases[0].createBeamTemperatureLoad(
            elMap.get(l.target)!,
            cloneClipboardValue(l.values)
          );
        }
      }
    });
  };

  const midpoint = () => {
    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];

    for (const node of selection.nodes) {
      const n = useProjectStore().solver.domain.nodes.get(node)!;
      min = [Math.min(min[0], n.coords[0]), Math.min(min[1], n.coords[1]), Math.min(min[2], n.coords[2])];
      max = [Math.max(max[0], n.coords[0]), Math.max(max[1], n.coords[1]), Math.max(max[2], n.coords[2])];
    }

    // loop elements
    for (const element of selection.elements) {
      const e = useProjectStore().solver.domain.elements.get(element) as Beam2D;
      for (const n of e.nodes) {
        const node = useProjectStore().solver.domain.nodes.get(n)!;
        min = [Math.min(min[0], node.coords[0]), Math.min(min[1], node.coords[1]), Math.min(min[2], node.coords[2])];
        max = [Math.max(max[0], node.coords[0]), Math.max(max[1], node.coords[1]), Math.max(max[2], node.coords[2])];
      }
    }

    return [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  };

  const clear = () => {
    selection.nodes = [];
    selection.elements = [];
    selection.nodalLoads = [];
    selection.elementLoads = [];
    selection.prescribedBC = [];
    selection.dimensions = [];
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

      const moved = new Set(selection.nodes);

      for (const label of selection.elements) {
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
        if (!dimension.id || !selection.dimensions.includes(dimension.id)) continue;

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

  const isAnythingInClipboard = () => {
    return (
      selection.nodes.length > 0 ||
      selection.elements.length > 0 ||
      selection.nodalLoads.length > 0 ||
      selection.elementLoads.length > 0 ||
      selection.prescribedBC.length > 0
    );
  };

  return {
    selection,
    mode,
    select,
    paste,
    move,
    clear,
    midpoint,
    isAnythingInClipboard,
  };
});
