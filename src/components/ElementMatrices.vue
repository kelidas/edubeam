<script setup lang="ts">
import { computed, ref } from 'vue';
import { Beam2D } from 'ts-fem';
import { useProjectStore } from '../store/project';
import { useAppStore } from '../store/app';
import { formatResultAsText } from '../utils/numberDisplay';
import {
  ELEMENT_DOFS,
  endForcesGlobal,
  endForcesLocal,
  globalStiffness,
  hasSystemMatrix,
  localStiffness,
  systemStiffness,
  transformation,
  type Grid,
} from '../utils/elementMatrices';

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = defineProps<{
  label: string;
}>();

/**
 * Condensation is the interesting part of a released element, so it is a switch rather than a
 * decision made here: the uncondensed matrix is the beam anyone would write down, and the condensed
 * one is what the structure is actually solved with.
 */
const condensed = ref(true);
/** The assembled structure, rather than this element. Reduced means the free block alone. */
const reduced = ref(true);

const element = computed(() => {
  const found = projectStore.solver.domain.elements.get(props.label);

  return found instanceof Beam2D ? found : null;
});

const usable = computed(() => {
  const el = element.value;

  if (!el) return false;

  return !!projectStore.solver.domain.materials.get(el.mat) && !!projectStore.solver.domain.crossSections.get(el.cs);
});

/**
 * The case being read. There is one today; the influence line work adds a second and exposes the
 * active one as `projectStore.loadCase`, which is what this should follow once that lands.
 */
const loadCase = computed(() => projectStore.solver.loadCases[0]);

const solved = computed(() => loadCase.value?.solved === true);

const hinged = computed(() => element.value?.hasHinges() === true);

interface Block {
  title: string;
  grid: Grid;
  /** Names down the side, and across the top when it is a matrix rather than a vector. */
  labels?: readonly string[];
}

const elementBlocks = computed<Block[]>(() => {
  const el = element.value;

  if (!el || !usable.value) return [];

  const blocks: Block[] = [
    {
      title: `Local stiffness — ${condensed.value ? 'condensed' : 'uncondensed'}`,
      grid: localStiffness(el, condensed.value),
      labels: ELEMENT_DOFS,
    },
    { title: 'Global stiffness', grid: globalStiffness(el), labels: ELEMENT_DOFS },
    { title: 'Transformation T — global to local', grid: transformation(el), labels: ELEMENT_DOFS },
  ];

  if (!solved.value) return blocks;

  const lc = loadCase.value;
  const local = endForcesLocal(el, lc);
  const global = endForcesGlobal(el, lc);

  return [
    ...blocks,
    { title: 'End forces, local — primary', grid: local.primary, labels: ELEMENT_DOFS },
    { title: 'End forces, local — secondary', grid: local.secondary, labels: ELEMENT_DOFS },
    { title: 'End forces, local — total', grid: local.total, labels: ELEMENT_DOFS },
    { title: 'End forces, global — primary', grid: global.primary, labels: ELEMENT_DOFS },
    { title: 'End forces, global — secondary', grid: global.secondary, labels: ELEMENT_DOFS },
    { title: 'End forces, global — total', grid: global.total, labels: ELEMENT_DOFS },
  ];
});

const systemBlock = computed<Block | null>(() => {
  if (!hasSystemMatrix(projectStore.solver)) return null;

  const grid = systemStiffness(projectStore.solver, reduced.value);

  return {
    title: `Structure stiffness — ${reduced.value ? `free block, ${grid.length} equations` : `assembled, ${grid.length} equations`}`,
    grid,
  };
});

/**
 * Always engineering, whatever the app is set to: an exponent that is a multiple of three reads as
 * a unit prefix, which is how these magnitudes are spoken about. The formatter still comes from the
 * store, so the decimal separator follows the language.
 */
const show = (value: number) => formatResultAsText(value, 'engineering', appStore.resultFormatter);

const isVector = (grid: Grid) => grid.every((row) => row.length === 1);
</script>

<template>
  <div class="fill-height pa-2" style="overflow: auto">
    <template v-if="usable">
      <div class="d-flex align-center ga-4 mb-2 text-caption">
        <v-checkbox-btn
          v-model="condensed"
          :disabled="!hinged"
          density="compact"
          hide-details
          :label="hinged ? 'Condensed' : 'Condensed (no hinge)'"
        />
        <v-checkbox-btn v-model="reduced" density="compact" hide-details label="Structure: free block only" />
        <span class="text-medium-emphasis ml-auto">SI units, engineering notation</span>
      </div>

      <div v-if="!solved" class="text-caption text-medium-emphasis mb-2">
        The structure is not solved, so only the matrices are shown.
      </div>

      <template v-for="block in elementBlocks" :key="block.title">
        <div class="text-caption font-weight-medium mt-3 mb-1">{{ block.title }}</div>
        <v-table class="border text-right" density="compact">
          <tbody>
            <tr v-for="(row, i) in block.grid" :key="i">
              <th class="text-left px-2 text-medium-emphasis font-weight-regular">{{ block.labels?.[i] }}</th>
              <td
                v-for="(value, j) in row"
                :key="j"
                class="px-2"
                :class="{ 'bg-grey-lighten-4': !isVector(block.grid) && i === j }"
              >
                {{ show(value) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>

      <template v-if="systemBlock">
        <div class="text-caption font-weight-medium mt-4 mb-1">{{ systemBlock.title }}</div>
        <v-table class="border text-right" density="compact">
          <tbody>
            <tr v-for="(row, i) in systemBlock.grid" :key="i">
              <th class="text-left px-2 text-medium-emphasis font-weight-regular">{{ i + 1 }}</th>
              <td v-for="(value, j) in row" :key="j" class="px-2" :class="{ 'bg-grey-lighten-4': i === j }">
                {{ show(value) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </template>
    </template>

    <div v-else class="pa-3">Element does not specify material or cross section.</div>
  </div>
</template>

<style scoped>
table td + td,
table th + td {
  border-left: 1px solid #dddddd;
}
</style>
