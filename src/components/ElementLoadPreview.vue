<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import SVGElementViewer from './SVGElementViewer.vue';
import { useAppStore } from '@/store/app';
import {
  Beam2D,
  BeamConcentratedLoad,
  BeamElementLoad,
  BeamElementTrapezoidalEdgeLoad,
  LinearStaticSolver,
  Node,
} from 'ts-fem';
import { useViewerStore } from '@/store/viewer';
import { createDimensionRenderableNode } from '@/types/dimension';

const props = withDefaults(
  defineProps<{
    load?: BeamElementLoad | null;
    height?: number;
    showElementLabels?: boolean;
    showNodeLabels?: boolean;
  }>(),
  {
    load: null,
    height: 200,
    showElementLabels: true,
    showNodeLabels: false,
  }
);

const viewerStore = useViewerStore();
const viewer = ref<InstanceType<typeof SVGElementViewer> | null>(null);
const solver = ref(new LinearStaticSolver());
const appStore = useAppStore();

const elements = computed(() => {
  if (!props.load) return [];
  return [props.load.domain.elements.get(props.load.target) as Beam2D];
});

// computed nodes from load's element and domain
const nodes = computed<Node[]>(() => {
  if (!props.load) return [];

  const element = props.load.domain.elements.get(props.load.target);
  if (!element) return [];

  // get nodes from element
  return element.nodes.map((nodeId) => props.load!.domain.nodes.get(nodeId)!);
});

/**
 * What the preview measures out: where along the element the load sits.
 *
 * A concentrated load has one such distance and a trapezoidal load given a position has two, and
 * both are read from the element's first node - which is what the boxes beside the preview ask
 * for, so the drawing and the numbers being typed say the same thing. A load that covers its whole
 * element has nothing to measure: the element's own length is the answer.
 */
const dimensionLines = computed(() => {
  const load = props.load;

  if (!load) return [];

  const element = load.domain.elements.get(load.target) as Beam2D | undefined;
  if (!element) return [];

  const startNode = load.domain.nodes.get(element.nodes[0]);
  if (!startNode) return [];

  const geo = element.computeGeo();
  const elementLength = geo?.l ?? 0;
  if (!elementLength) return [];

  const cos = geo.dx / elementLength || 0;
  const sin = geo.dz / elementLength || 0;
  const step = Math.min(Math.max(elementLength * 0.15, 0.25), 2);

  /** One dimension, from the first node to a point that far along the element. */
  const measured = (distance: number, label: string, line: number) => {
    const along = Math.min(Math.max(distance, 0), elementLength);
    const to = new Node(label, load.domain, [
      startNode.coords[0] + cos * along,
      startNode.coords[1],
      startNode.coords[2] + sin * along,
    ]);

    return {
      points: [
        createDimensionRenderableNode({ x: startNode.coords[0], y: startNode.coords[2] }, startNode.label),
        createDimensionRenderableNode({ x: to.coords[0], y: to.coords[2] }, to.label),
      ],
      // stacked, so two of them are read one under the other rather than on top of each other
      distance: step * line,
      numberFormat: appStore.numberFormatter,
      convertLength: appStore.convertLength,
    };
  };

  if (load instanceof BeamConcentratedLoad) {
    return [measured(load.values[3] ?? 0, '__preview-load-distance', 1)];
  }

  if (load instanceof BeamElementTrapezoidalEdgeLoad && load.partial()) {
    const from = load.from ?? 0;
    const to = load.to ?? elementLength;

    return [measured(from, '__preview-load-from', 1), measured(to, '__preview-load-to', 2)];
  }

  return [];
});

watch(
  () => props.load,
  async (target, previousTarget) => {
    if (!target || target === previousTarget) return;

    await nextTick();
    viewer.value?.fitContent();
  },
  { flush: 'post' }
);
</script>

<template>
  <div class="element-load-preview" :style="{ height: `${height}px` }">
    <SVGElementViewer
      :id="`element-load-preview`"
      ref="viewer"
      class="overflow-hidden pa-1 w-100"
      :solver="solver"
      :nodes="nodes"
      :elements="elements"
      :dimlines="dimensionLines"
      :element-loads="[load]"
      :show-node-labels="showNodeLabels"
      :show-element-labels="showElementLabels"
      :show-deformed-shape="false"
      :show-reactions="false"
      :show-loads="true"
      :show-moments="false"
      :show-normal-force="false"
      :show-shear-force="false"
      :padding="24"
      :mobile-padding="24"
      :results-scale-px="32"
      fit-ignore="[data-fit-ignore='results']"
      :fit-reserve-px="0"
      :support-size="0.75"
      :number-format="appStore.numberFormatter"
      :convert-force="appStore.convertForce"
      :convert-force-distance="appStore.convertForceDistance"
      :convert-moment="appStore.convertMoment"
      :convert-length="appStore.convertLength"
      :colors="viewerStore.colors"
    />
  </div>
</template>

<style scoped>
.element-load-preview {
  min-height: 160px;
}
</style>
