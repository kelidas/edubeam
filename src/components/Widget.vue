<script lang="ts" setup>
import StiffnessMatrix from '@/components/StiffnessMatrix.vue';
import SVGElementViewer from '@/components/SVGElementViewer.vue';

import { onMounted, onUnmounted, ref, computed } from 'vue';

import { useAppStore } from '@/store/app';
import { useProjectStore } from '@/store/project';
import { useLayoutStore } from '@/store/layout';

const appStore = useAppStore();
const projectStore = useProjectStore();
const layoutStore = useLayoutStore();

const props = withDefaults(
  defineProps<{
    widget: unknown;
  }>(),
  {}
);
</script>

<template>
  <!--
    The frame could always be dragged by a corner, but nothing inside followed: the card kept its
    natural size, so a widget full of numbers could not be made bigger to read them. The card now
    fills the frame and its content scrolls within it, which is what makes the resize worth having.
  -->
  <vue-draggable-resizable
    :w="props.widget.props.w ?? 400"
    :h="props.widget.props.h ?? 320"
    :min-width="240"
    :min-height="160"
    :x="props.widget.props.x"
    :y="props.widget.props.y"
    :parent="true"
    :active="true"
    :prevent-deactivation="true"
    drag-handle=".drag-handle"
  >
    <v-card class="d-flex flex-column" style="pointer-events: auto; height: 100%">
      <div class="d-flex drag-handle flex-grow-0">
        <div class="d-flex align-center flex-grow-1">
          <div v-if="props.widget.props.label" style="width: 64px; height: 48px">
            <SVGElementViewer
              v-if="projectStore.solver.domain.elements.has(props.widget.props.label)"
              class="overflow-hidden pa-1"
              :solver="projectStore.solver"
              :nodes="[]"
              :elements="[projectStore.solver.domain.getElement(props.widget.props.label)]"
              :padding="1"
              :mobile-padding="1"
              no-fit-for-results
            />
          </div>
          <div class="d-flex flex-column w-100 mb-1 px-3">
            <div v-if="props.widget.title" class="text-h6">{{ props.widget.title }}</div>
            <div v-if="props.widget.props.label" class="d-flex">
              <div>Element {{ props.widget.props.label }} {{ props.x }}</div>
              <!-- <div class="ml-1">
                <v-btn icon="mdi-content-copy" size="small" density="compact" variant="text"> </v-btn>
              </div> -->
            </div>
          </div>
        </div>
        <div class="">
          <v-btn
            v-if="props.widget.closable"
            icon="mdi-close"
            size="small"
            variant="text"
            small
            class="ml-1"
            @click.prevent.stop="layoutStore.removeWidget(props.widget.id)"
          />
        </div>
      </div>
      <div class="flex-grow-1" style="min-height: 0; overflow: auto">
        <component :is="props.widget.component" v-bind="props.widget.props" />
      </div>
    </v-card>
  </vue-draggable-resizable>
</template>

<style scoped>
/*
 * Two things kept the corner from being grabbed.
 *
 * The widgets sit in a full screen layer that lets pointer events through to the drawing, and only
 * the card takes them back. The resize handles are siblings of that card inside the frame, so they
 * inherited the layer's `pointer-events: none` and could be aimed at but never hit.
 *
 * The other half - the handles being hidden until the widget is "active", which it becomes only
 * when a press lands on the title bar - is settled on the frame itself with `active` and
 * `prevent-deactivation`, rather than by overriding the library's own display rule.
 */
:deep(.handle) {
  pointer-events: auto;
}
</style>
