// Utilities
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import type { ViewBox } from '@/utils/fitBounds';
import { defaultGridStep } from '@/utils/grid';
import { useAppStore } from './app';

export const useViewerStore = defineStore(
  'viewer',
  () => {
    const resultLabelMode = ref<'axis' | 'horizontal'>('axis');
    const showSupports = ref(true);
    const showNodeLabels = ref(true);
    const showElementLabels = ref(true);

    const showLoads = ref(true);

    /**
     * Which results are drawn, and how tall, kept per workspace.
     *
     * The two viewers are on screen for different questions - the load case is read for its
     * moments, the influence line for its deflected shape - and both are mounted at once, so this
     * cannot be one set of flags with the active workspace deciding. Everything else about the
     * viewer (colours, type size, grid, labels) stays shared: it is how the drawing looks, not
     * what it is showing.
     */
    const makeResults = () => ({
      showNormalForce: false,
      showShearForce: false,
      showBendingMoment: true,
      showDeformedShape: true,
      showRotation: false,
      showReactions: true,
      // Per quantity multiplier on top of the automatic scale, so a diagram that comes out too
      // flat or too tall can be adjusted without touching the others.
      resultScale: { deformedShape: 1, rotation: 1, normalForce: 1, shearForce: 1, bendingMoment: 1 },
      // Whether the scale rows are on screen. Per workspace like the rest of this set, so opening
      // them where they are wanted does not put them in front of the other viewer as well.
      showScalePanel: false,
    });

    const results = reactive({
      viewer: makeResults(),
      // The influence line is read from its deflected shape, so that is what it opens showing.
      influence: { ...makeResults(), showBendingMoment: false, showReactions: false, showScalePanel: true },
    });

    /** The set belonging to a viewer. Its id is the workspace it draws. */
    const resultsFor = (workspace: string) => (workspace === 'influence' ? results.influence : results.viewer);

    const colors = reactive({
      normalForce: '#2222ff', // used
      shearForce: '#00af00', // used
      bendingMoment: '#ff2222', // used
      deformedShape: '#555555', // used
      rotation: '#00838f', // used
      loads: '#ff8700', // used
      nodes: '#000000',
      elements: '#000000',
      reactions: '#a020f0', // used
    });

    const showGrid = ref(true);
    const snapToGrid = ref(true);
    // In metres, like the model; a fresh grid starts at a round step of the length unit
    const gridStep = ref(defaultGridStep(useAppStore().units.Length));
    const showCrosshair = ref(true);
    /** Outline how a structure that is not held can still move. */
    const showMechanisms = ref(true);
    /** Swing that outline; off, it is drawn standing still. */
    const animateMechanisms = ref(true);
    const resultsScalePx_ = ref(48);

    const supportSize = ref(1);

    const fontSize = ref(14);

    const settingsOpen = ref(true);

    const reset = () => {
      resultLabelMode.value = 'axis';
      showSupports.value = true;
      showNodeLabels.value = true;
      showElementLabels.value = true;

      showLoads.value = true;

      Object.assign(results.viewer, makeResults());
      Object.assign(results.influence, {
        ...makeResults(),
        showBendingMoment: false,
        showReactions: false,
        showScalePanel: true,
      });

      colors.normalForce = '#2222ff';
      colors.shearForce = '#00af00';
      colors.bendingMoment = '#ff2222';
      colors.deformedShape = '#555555';
      colors.loads = '#ff8700';
      colors.nodes = '#000000';
      colors.elements = '#000000';
      colors.reactions = '#a020f0';

      showGrid.value = true;
      snapToGrid.value = true;
      gridStep.value = defaultGridStep(useAppStore().units.Length);
      showCrosshair.value = true;
      showMechanisms.value = true;
      animateMechanisms.value = true;
      resultsScalePx_.value = 48;
      supportSize.value = 1;

      fontSize.value = 14;

      settingsOpen.value = true;
    };

    /**
     * The export dialog asking the drawing for a window.
     *
     * The dialog steps aside, the viewer switches to `MouseMode.PICK_WINDOW`, and the
     * rectangle the user drags is handed back through here — `null` when they cancel.
     * A plain resolver rather than state, because nothing needs to render it.
     */
    let windowPickResolver: ((box: ViewBox | null) => void) | null = null;

    const pickWindow = () =>
      new Promise<ViewBox | null>((resolve) => {
        windowPickResolver?.(null);
        windowPickResolver = resolve;
      });

    const finishWindowPick = (box: ViewBox | null) => {
      const resolve = windowPickResolver;

      windowPickResolver = null;
      resolve?.(box);
    };

    return {
      pickWindow,
      finishWindowPick,
      resultLabelMode,
      colors,
      showNodeLabels,
      showLoads,
      showElementLabels,
      showSupports,
      results,
      resultsFor,

      showGrid,
      snapToGrid,
      gridStep,
      showCrosshair,
      showMechanisms,
      animateMechanisms,
      resultsScalePx_: resultsScalePx_,

      fontSize,

      supportSize,

      settingsOpen,

      reset,
    };
  },
  { persist: true }
);
