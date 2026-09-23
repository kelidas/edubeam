<template>
  <div class="d-flex flex-column">
    <div v-if="!appStore.inViewerMode">
      <div class="" style="border-bottom: 1px solid rgba(0, 0, 0, 0.12)">
        <v-tabs v-model="appStore.tab" height="36" bg-color="secondary">
          <!-- named after the workspace it opens, so the tour can point at one of them -->
          <v-tab
            v-for="(item, index) in appStore.tabs"
            :id="item.props.id ? `tab-${item.props.id}` : undefined"
            :key="item.title"
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
        </v-tabs>
      </div>
    </div>
    <!--
      A window changes its item on a horizontal swipe, and the canvas fills one: panning a drawing
      or pinching it would leave the tab. Tabs are changed from the tab bar.
    -->
    <v-window
      v-model="appStore.tab"
      class="fill-height"
      :touch="false"
      :style="`${projStore.selection.type !== null ? 'overflow: visible !important;' : ''}`"
    >
      <!--
        The drawing fills its tab and must not scroll - a canvas pans instead. A panel of settings
        is taller than the tab on a short window, and nothing above it scrolls, so it says so itself.
      -->
      <v-window-item
        v-for="item in appStore.tabs"
        :key="item.title"
        class="fill-height"
        :class="item.scrolls ? 'overflow-y-auto' : 'overflow-hidden'"
        :transition="false"
        :reverse-transition="false"
      >
        <keep-alive>
          <component :is="item.component" v-bind="item.props" />
        </keep-alive>
      </v-window-item>
    </v-window>
  </div>
</template>

<script setup lang="ts">
import { useAppStore } from '../store/app';
import { useProjectStore } from '../store/project';

const appStore = useAppStore();
const projStore = useProjectStore();
</script>
