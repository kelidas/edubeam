<script setup lang="ts">
import { computed, ref } from 'vue';
import { Beam2D } from 'ts-fem';
import { useProjectStore } from '../store/project';
import { useAppStore } from '../store/app';
import { formatResultAsText } from '../utils/numberDisplay';
import {
  elementLength,
  extremesOf,
  resultsAlong,
  resultsAt,
  type SectionQuantity,
  type SectionResult,
} from '../utils/sectionResults';

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = defineProps<{
  label: string;
}>();

/**
 * How many pieces the element is cut into. Eight gives a section every eighth of the span, which is
 * what a hand calculation would tabulate; the ends are always there on top of that.
 */
const divisions = ref(8);

/** A section the reader asks for by hand, in the length unit on show. */
const position = ref<number | null>(null);

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

const solved = computed(() => usable.value && loadCase.value?.solved === true);

const length = computed(() => (element.value ? elementLength(element.value) : 0));

const sections = computed<SectionResult[]>(() =>
  solved.value ? resultsAlong(element.value!, loadCase.value, divisions.value) : []
);

/** The one section typed in, if any. It is clamped onto the element, so it is always a real one. */
const asked = computed<SectionResult | null>(() => {
  if (!solved.value || position.value === null || !Number.isFinite(position.value)) return null;

  return resultsAt(element.value!, loadCase.value, appStore.convertInverseLength(position.value));
});

const extremes = computed(() => extremesOf(sections.value));

interface Quantity {
  key: SectionQuantity;
  name: string;
  unit: string;
  convert: (value: number) => number;
}

/**
 * Each of these carries one unit, unlike a stiffness matrix, so they are shown converted and
 * labelled - a shear in kN next to a deflection in mm is what anyone reading a section wants.
 */
const quantities = computed<Quantity[]>(() => [
  { key: 'n', name: 'N', unit: appStore.units.Force, convert: appStore.convertForce },
  { key: 'vz', name: 'V', unit: appStore.units.Force, convert: appStore.convertForce },
  { key: 'my', name: 'M', unit: appStore.units.Moment, convert: appStore.convertMoment },
  { key: 'u', name: 'u', unit: appStore.units.Length, convert: appStore.convertLength },
  { key: 'w', name: 'w', unit: appStore.units.Length, convert: appStore.convertLength },
]);

const show = (value: number) => appStore.formatResultText(Object.is(value, -0) ? 0 : value);

/**
 * Positions along the element, which are read differently from the results beside them: a section
 * at a third of a six metre beam is 2 m, not 2·10⁰, whatever exponent style the results are set to.
 * The plain range is wide enough that a distance almost always falls inside it.
 */
const showLength = (value: number) => formatResultAsText(value, 'auto', appStore.resultFormatter);

/** The largest of each quantity across the sections shown, which is what the bars are drawn to. */
const largest = computed<Record<SectionQuantity, number>>(() => {
  const found = {} as Record<SectionQuantity, number>;

  for (const { key } of quantities.value) {
    found[key] = sections.value.reduce((max, section) => Math.max(max, Math.abs(section[key])), 0);
  }

  return found;
});

/**
 * A bar behind the number, from the middle of the cell: right for positive, left for negative.
 *
 * The shape of a diagram is the thing a table hides - a column of numbers does not show where the
 * moment peaks or where the shear changes sign the way a drawing does. Reading it as a background
 * keeps the numbers themselves untouched and exact.
 */
const bar = (section: SectionResult, key: SectionQuantity) => {
  const max = largest.value[key];

  if (!max) return {};

  const half = (50 * section[key]) / max;
  const [from, to] = half < 0 ? [50 + half, 50] : [50, 50 + half];
  const colour = 'rgba(25, 118, 210, 0.16)';

  return {
    backgroundImage: `linear-gradient(to right, transparent ${from}%, ${colour} ${from}%, ${colour} ${to}%, transparent ${to}%)`,
  };
};

/** Everything on show, tab separated, so it can go straight into a spreadsheet. */
const copy = () => {
  const header = ['x', ...quantities.value.map((q) => q.name)].join('\t');
  const line = (section: SectionResult) =>
    [appStore.convertLength(section.x), ...quantities.value.map((q) => q.convert(section[q.key]))].join('\t');

  navigator.clipboard?.writeText([header, ...sections.value.map(line)].join('\n'));
};
</script>

<template>
  <div class="fill-height d-flex flex-column">
    <template v-if="usable">
      <div class="d-flex align-center ga-3 pa-2 flex-grow-0 border-b">
        <v-text-field
          v-model.number="divisions"
          type="number"
          min="1"
          max="200"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 110px"
          :label="$t('common.divisions')"
        />
        <!--
          A section asked for by hand is the other half of the question: not "what does it do along
          its length" but "what does it carry here". It is solved at that distance rather than read
          off the table, so it does not depend on the division count landing on it.
        -->
        <v-text-field
          v-model.number="position"
          type="number"
          :min="0"
          :max="appStore.convertLength(length)"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          style="max-width: 160px"
          :label="`${$t('common.atPosition')} [${appStore.units.Length}]`"
        />
        <span class="text-caption text-medium-emphasis"
          >L = {{ showLength(appStore.convertLength(length)) }} {{ appStore.units.Length }}</span
        >
        <v-btn
          icon="mdi-content-copy"
          size="small"
          density="comfortable"
          variant="text"
          class="ml-auto"
          :title="$t('common.copy')"
          @click="copy"
        />
      </div>

      <div class="flex-grow-1 pa-2" style="overflow: auto">
        <div v-if="!solved" class="text-caption text-medium-emphasis">{{ $t('common.notSolved') }}</div>

        <v-table v-else class="border text-right" density="compact" style="white-space: nowrap">
          <thead>
            <tr>
              <th class="text-right px-2 font-weight-regular">
                x<span class="text-medium-emphasis"> [{{ appStore.units.Length }}]</span>
              </th>
              <th v-for="q in quantities" :key="q.key" class="text-right px-2 font-weight-regular">
                {{ q.name }}<span class="text-medium-emphasis"> [{{ q.unit }}]</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <!-- The section asked for sits above the regular ones, marked, in the same columns. -->
            <tr v-if="asked" class="bg-blue-lighten-5">
              <th class="text-right px-2 font-weight-regular">
                <v-icon size="12" icon="mdi-arrow-right-thin" class="mr-1" />{{
                  showLength(appStore.convertLength(asked.x))
                }}
              </th>
              <td v-for="q in quantities" :key="q.key" class="px-2">{{ show(q.convert(asked[q.key])) }}</td>
            </tr>
            <tr v-for="(section, i) in sections" :key="i">
              <th class="text-right px-2 text-medium-emphasis font-weight-regular">
                {{ showLength(appStore.convertLength(section.x)) }}
              </th>
              <td
                v-for="q in quantities"
                :key="q.key"
                class="px-2"
                :class="{ 'font-weight-bold': extremes[q.key] === i }"
                :style="bar(section, q.key)"
              >
                {{ show(q.convert(section[q.key])) }}
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-if="solved" class="text-caption text-medium-emphasis mt-2">{{ $t('common.extremeShownHint') }}</div>
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
