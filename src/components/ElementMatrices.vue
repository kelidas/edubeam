<script setup lang="ts">
import { computed, ref } from 'vue';
import { Beam2D } from 'ts-fem';
import { useProjectStore } from '../store/project';
import { useAppStore } from '../store/app';
import { formatResultAsText } from '../utils/numberDisplay';
import {
  assembleFrom,
  elementDofNames,
  ELEMENT_DOFS,
  occupied,
  only,
  structureDofNames,
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
  /** Without one the widget is about the structure alone, and opens on that tab. */
  label?: string;
}>();

const tab = ref(props.label ? 'kloc' : 'system');

/**
 * Condensation is the interesting part of a released element, so it is a switch rather than a
 * decision made here: the uncondensed matrix is the beam anyone would write down, the condensed one
 * is what the structure is solved with.
 */
const condensed = ref(true);
/** The assembled structure, or only the free block it is solved on. */
const reduced = ref(true);

/**
 * Whether rows and columns carrying nothing are left out.
 *
 * Assembling from a few chosen elements leaves the rest of the structure empty, and there are
 * usually far more of those rows than of the ones being looked at. Their names are kept with them,
 * so what remains still says which equation each row is.
 */
const hideEmpty = ref(true);

const element = computed(() => {
  if (!props.label) return null;

  const found = projectStore.solver.domain.elements.get(props.label);

  return found instanceof Beam2D ? found : null;
});

/** Elements picked in the drawing, whose contribution alone can be assembled. */
const selected = computed(() =>
  projectStore.selection2.elements
    .map((label) => projectStore.solver.domain.elements.get(label))
    .filter((el): el is Beam2D => el instanceof Beam2D)
);

/** The structure as assembled from everything, or only from what is picked in the drawing. */
const selectionOnly = ref(false);

const usable = computed(() => {
  const el = element.value;

  if (!el) return false;

  return !!projectStore.solver.domain.materials.get(el.mat) && !!projectStore.solver.domain.crossSections.get(el.cs);
});

/**
 * The case being read, which is the one the open tab is about: the real loads in the viewer, the
 * unit dislocations in the influence line workspace - falling back to the only case there is where
 * the app has no second workspace to speak of. Only the end force vectors depend on it - a
 * stiffness matrix is a property of the structure, not of what is put on it.
 */
const loadCase = computed(() => projectStore.loadCase ?? projectStore.solver.loadCases[0]);

const solved = computed(() => loadCase.value?.solved === true);

const hinged = computed(() => element.value?.hasHinges() === true);

/**
 * All six end force vectors side by side rather than one under another.
 *
 * Reading down a column is one vector; reading across a row is the same degree of freedom in both
 * frames. And primary plus secondary is total, which is far easier to see when the three stand next
 * to each other than when they are three separate tables.
 */
const END_FORCE_COLUMNS = ['prim loc', 'sec loc', 'tot loc', 'prim glob', 'sec glob', 'tot glob'];

/** The six degrees of freedom of the open element, named by the nodes they belong to. */
const dofNames = computed(() => (element.value ? elementDofNames(element.value) : [...ELEMENT_DOFS]));

const endForces = computed<Grid>(() => {
  const el = element.value;

  if (!el || !usable.value || !solved.value) return [];

  const local = endForcesLocal(el, loadCase.value);
  const global = endForcesGlobal(el, loadCase.value);

  return ELEMENT_DOFS.map((_, i) => [
    local.primary[i][0],
    local.secondary[i][0],
    local.total[i][0],
    global.primary[i][0],
    global.secondary[i][0],
    global.total[i][0],
  ]);
});

/** What the open tab puts in the one table below: its numbers, and the names around them. */
const view = computed(() => {
  const el = element.value;

  const nothing = { grid: [] as Grid, rows: [] as readonly string[], cols: [] as readonly string[] };

  if (tab.value !== 'system' && (!el || !usable.value)) return nothing;

  if (tab.value === 'kglob') {
    return { grid: globalStiffness(el!), rows: dofNames.value, cols: dofNames.value };
  }

  if (tab.value === 't') {
    // T maps global to local, so its rows and its columns are not the same frame
    return { grid: transformation(el!), rows: dofNames.value, cols: dofNames.value };
  }

  if (tab.value === 'forces') {
    return { grid: endForces.value, rows: dofNames.value, cols: END_FORCE_COLUMNS };
  }

  if (tab.value === 'system') {
    const grid = !hasSystemMatrix(projectStore.solver)
      ? []
      : selectionOnly.value
        ? assembleFrom(projectStore.solver, selected.value, reduced.value)
        : systemStiffness(projectStore.solver, reduced.value);
    // the same names as an element's own, so one element's 6x6 can be found inside the assembled one
    const names = grid.length ? structureDofNames(projectStore.solver) : [];
    const kept = hideEmpty.value ? occupied(grid) : grid.map((_, i) => i);

    return { grid: only(grid, kept), rows: kept.map((i) => names[i]), cols: kept.map((i) => names[i]) };
  }

  return { grid: localStiffness(el!, condensed.value), rows: dofNames.value, cols: dofNames.value };
});

/** How many rows the structure matrix is not showing, which is worth saying rather than hiding. */
const dropped = computed(() => {
  if (tab.value !== 'system' || !hideEmpty.value || !hasSystemMatrix(projectStore.solver)) return 0;

  const size = selectionOnly.value
    ? assembleFrom(projectStore.solver, selected.value, reduced.value).length
    : systemStiffness(projectStore.solver, reduced.value).length;

  return size - view.value.grid.length;
});

/** A square matrix gets its leading diagonal marked; a set of vectors has no diagonal to mark. */
const square = computed(() => tab.value !== 'forces');

const empty = computed(() => view.value.grid.length === 0);

/**
 * Always engineering, whatever the app is set to: an exponent that is a multiple of three reads as
 * a unit prefix, which is how these magnitudes are spoken about. The formatter comes from the
 * store, so the decimal separator follows the language.
 *
 * Negative zero is written as zero. A transformation matrix is full of it - the sine of an element
 * lying along x - and "-0" reads as a value rather than as the absence of one.
 */
const show = (value: number) =>
  formatResultAsText(Object.is(value, -0) ? 0 : value, 'engineering', appStore.resultFormatter);

/** What is on show, tab separated with its names, so it can go straight into a spreadsheet. */
const copy = () => {
  const header = ['', ...view.value.cols].join('\t');
  const rows = view.value.grid.map((row, i) => [view.value.rows[i], ...row].join('\t'));

  navigator.clipboard?.writeText([header, ...rows].join('\n'));
};
</script>

<template>
  <div class="fill-height d-flex flex-column">
    <!-- Opened on the structure rather than on an element, only the structure has anything to say. -->
    <template v-if="usable || !props.label">
      <v-tabs v-model="tab" density="compact" class="flex-grow-0 border-b">
        <template v-if="usable">
          <v-tab value="kloc" class="text-none px-3">K loc</v-tab>
          <v-tab value="kglob" class="text-none px-3">K glob</v-tab>
          <v-tab value="t" class="text-none px-3">T</v-tab>
          <v-tab value="forces" class="text-none px-3">{{ $t('common.endForces') }}</v-tab>
        </template>
        <v-tab value="system" class="text-none px-3">{{ $t('common.structure') }}</v-tab>
      </v-tabs>

      <div class="flex-grow-1 pa-2" style="overflow: auto">
        <div class="d-flex align-center ga-3 mb-2 text-caption">
          <v-checkbox-btn
            v-if="tab === 'kloc'"
            v-model="condensed"
            :disabled="!hinged"
            density="compact"
            hide-details
            :label="hinged ? $t('common.condensed') : $t('common.condensedNoHinge')"
          />
          <v-checkbox-btn
            v-if="tab === 'system'"
            v-model="reduced"
            density="compact"
            hide-details
            :label="$t('common.freeBlockOnly')"
          />
          <!--
            One element's contribution sitting in the structure's own numbering is where the two
            pictures meet, so it is worth being able to see it on its own.
          -->
          <v-checkbox-btn
            v-if="tab === 'system'"
            v-model="selectionOnly"
            :disabled="selected.length === 0"
            density="compact"
            hide-details
            :label="`${$t('common.selectedElementsOnly')} (${selected.length})`"
          />
          <v-checkbox-btn
            v-if="tab === 'system'"
            v-model="hideEmpty"
            density="compact"
            hide-details
            :label="$t('common.hideEmptyRows')"
          />
          <span v-if="tab === 't'" class="text-medium-emphasis">{{ $t('common.transformationHint') }}</span>
          <span v-if="dropped > 0" class="text-medium-emphasis">{{
            $t('common.emptyRowsHidden', { n: dropped })
          }}</span>
          <v-chip v-if="tab === 'forces' && appStore.workspace === 'influence'" size="x-small" color="primary" label>
            {{ $t('tabView.influence') }}
          </v-chip>
          <span class="text-medium-emphasis ml-auto">SI</span>
          <v-btn
            icon="mdi-content-copy"
            size="small"
            density="comfortable"
            variant="text"
            :disabled="empty"
            :title="$t('common.copy')"
            @click="copy"
          />
        </div>

        <div v-if="empty" class="text-caption text-medium-emphasis">{{ $t('common.notSolved') }}</div>

        <v-table v-else class="border text-right" density="compact" style="white-space: nowrap">
          <thead>
            <tr>
              <th></th>
              <th v-for="(name, j) in view.cols" :key="j" class="text-right px-2 font-weight-regular">{{ name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in view.grid" :key="i">
              <th class="text-left px-2 text-medium-emphasis font-weight-regular">{{ view.rows[i] }}</th>
              <td v-for="(value, j) in row" :key="j" class="px-2" :class="{ 'bg-grey-lighten-4': square && i === j }">
                {{ show(value) }}
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
    </template>

    <div v-else class="pa-3">Element does not specify material or cross section.</div>
  </div>
</template>

<style scoped>
table td + td,
table th + td,
thead th + th {
  border-left: 1px solid #dddddd;
}
</style>
