<template>
  <div class="d-flex flex-column">
    <div v-if="!appStore.inViewerMode">
      <div class="" style="border-bottom: 1px solid rgba(0, 0, 0, 0.12)">
        <v-tabs v-model="appStore.tab" height="36" bg-color="secondary">
          <!--
            Named after the workspace it opens, so the tour can point at one of them. Each carries
            its own fixed position in appStore.tabs as its value, rather than the position it
            happens to render at, so hiding the influence tab does not shift what appStore.tab
            means for the ones after it.
          -->
          <template v-for="(item, index) in appStore.tabs" :key="item.title">
            <v-tab
              v-if="item.props.id !== 'influence' || appStore.showInfluenceWorkspace"
              :id="item.props.id ? `tab-${item.props.id}` : undefined"
              :value="index"
              :class="{ 'pr-0': item.closable }"
            >
              {{ $t(item.title) }}
              <v-btn
                v-if="item.closable"
                icon="mdi-close"
                size="x-small"
                variant="text"
                small
                class="ml-1"
                @click.prevent.stop="
                  appStore.tab = 0;
                  appStore.tabs.splice(index, 1);
                "
              />
            </v-tab>
          </template>
        </v-tabs>
      </div>
    </div>
    <!--
      A window changes its item on a horizontal swipe, and the canvas fills one: panning a drawing
      or pinching it would leave the tab. Tabs are changed from the tab bar.
    -->
    <v-window
      id="workspaceWindow"
      v-model="appStore.tab"
      class="fill-height"
      :touch="false"
      :style="`${projStore.selection.type !== null ? 'overflow: visible !important;' : ''}`"
    >
      <!--
        The drawing fills its tab and must not scroll - a canvas pans instead. A panel of settings
        is taller than the tab on a short window, and nothing above it scrolls, so it says so itself.
      -->
      <template v-for="(item, index) in appStore.tabs" :key="item.title">
        <v-window-item
          v-if="item.props.id !== 'influence' || appStore.showInfluenceWorkspace"
          :value="index"
          class="fill-height"
          :class="item.scrolls ? 'overflow-y-auto' : 'overflow-hidden'"
          :transition="false"
          :reverse-transition="false"
        >
          <keep-alive>
            <component :is="item.component" v-bind="item.props" />
          </keep-alive>
        </v-window-item>
      </template>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '../store/app';
import { useProjectStore } from '../store/project';

const appStore = useAppStore();
const projStore = useProjectStore();
</script>

<style scoped>
/*
 * Vuetify keeps the pane being left displayed for two frames after it stops being the active one.
 * Both are then in the flow at once: a column splits the height between them, so the arriving
 * drawing measures half the room it is about to get and fits itself to that, and both drawings are
 * painted over each other while it lasts. That is the flicker between the workspaces. One pane at a
 * time, and the one arriving has the room and the picture to itself from its first frame.
 */
#workspaceWindow > :deep(.v-window__container) > .v-window-item:not(.v-window-item--active) {
  display: none;
}
</style>
