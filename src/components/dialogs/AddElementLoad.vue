<template>
  <v-dialog v-model="open" max-width="420" attach=".v-application">
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ $t('dialogs.addElementLoad.addNewElementLoad') }}</span>
        <HelpTip topic="elementLoads" class="ml-1" />
      </v-card-title>

      <v-card-text>
        <v-select
          v-model="loadType"
          :items="loadTypes"
          item-title="label"
          item-value="value"
          :label="$t('loadType.loadType')"
          hide-details="auto"
        >
        </v-select>
        <v-form v-model="valid">
          <v-row no-gutters>
            <v-col v-if="previewLoad" cols="12" md="6" class="mb-4 mb-md-0 pe-md-4" align-self="center">
              <ElementLoadPreview class="w-100 pointer-events-none" :load="previewLoad" :show-node-labels="true" />
            </v-col>
            <v-col cols="12" :md="previewLoad ? 6 : 12" align-self="center">
              <v-row no-gutters>
                <v-col cols="12" md="12">
                  <v-select
                    v-model="loadElementId"
                    :items="projectStore.beams"
                    item-title="label"
                    item-value="label"
                    :label="$t('common.element')"
                    hide-details="auto"
                    required
                  />
                </v-col>

                <template v-if="['udl', 'concentrated'].includes(loadType)">
                  <v-col cols="12" md="12">
                    <v-text-field
                      v-model="loadNodeValueFx"
                      :label="`${unitAndLabel.l}x`"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="unitAndLabel.u"
                      @keydown="checkNumber($event)"
                    ></v-text-field>
                  </v-col>

                  <v-col cols="12" md="12">
                    <v-text-field
                      v-model="loadNodeValueFz"
                      :label="`${unitAndLabel.l}${appStore.axes.v}`"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="unitAndLabel.u"
                      @keydown="checkNumber($event)"
                    ></v-text-field>
                  </v-col>

                  <v-col v-if="loadType === 'concentrated'" cols="12" md="12">
                    <v-text-field
                      v-model="loadNodeValueMy"
                      :label="`M${appStore.axes.r}`"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="unitAndLabel.r"
                      @keydown="checkNumber($event)"
                    ></v-text-field>
                  </v-col>

                  <v-col v-if="loadType === 'concentrated'" cols="12" md="12">
                    <v-text-field
                      v-model="elementLoadPos"
                      :label="$t('loads.loadPositionOnBeam')"
                      hide-details="auto"
                      :rules="[...numberRules, minMax]"
                      :suffix="appStore.units.Length"
                      @keydown="checkNumber($event)"
                    />
                  </v-col>
                </template>

                <template v-else-if="loadType === 'trapezoidal'">
                  <v-col cols="12">
                    <v-row no-gutters>
                      <v-col cols="12" md="12">
                        <v-text-field
                          v-model="loadTrapezoidStartFx"
                          hide-details="auto"
                          :rules="numberRules"
                          :suffix="unitAndLabel.u"
                          @keydown="checkNumber($event)"
                        >
                          <template #label>
                            <span>f<sub>1</sub>x</span>
                          </template>
                        </v-text-field>
                      </v-col>
                      <v-col cols="12" md="12">
                        <v-text-field
                          v-model="loadTrapezoidEndFx"
                          hide-details="auto"
                          :rules="numberRules"
                          :suffix="unitAndLabel.u"
                          @keydown="checkNumber($event)"
                        >
                          <template #label>
                            <span>f<sub>2</sub>x</span>
                          </template>
                        </v-text-field>
                      </v-col>
                    </v-row>
                  </v-col>
                  <v-col cols="12">
                    <v-row no-gutters>
                      <v-col cols="12" md="12">
                        <v-text-field
                          v-model="loadTrapezoidStartFz"
                          hide-details="auto"
                          :rules="numberRules"
                          :suffix="unitAndLabel.u"
                          @keydown="checkNumber($event)"
                        >
                          <template #label>
                            <span>f<sub>1</sub>{{ appStore.axes.v }}</span>
                          </template>
                        </v-text-field>
                      </v-col>
                      <v-col cols="12" md="12">
                        <v-text-field
                          v-model="loadTrapezoidEndFz"
                          hide-details="auto"
                          :rules="numberRules"
                          :suffix="unitAndLabel.u"
                          @keydown="checkNumber($event)"
                        >
                          <template #label>
                            <span>f<sub>2</sub>{{ appStore.axes.v }}</span>
                          </template>
                        </v-text-field>
                      </v-col>
                    </v-row>
                  </v-col>
                  <!--
                    Where the load sits on the element, as distances from its first node. Left
                    empty it covers the whole element, which is what a trapezoidal load has always
                    been; a uniform load over part of an element is this with the same value typed
                    twice.
                  -->
                  <v-col cols="12">
                    <v-row no-gutters>
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="trapezoidFrom"
                          hide-details="auto"
                          :rules="spanRules"
                          :placeholder="$t('loads.wholeElement')"
                          persistent-placeholder
                          :suffix="appStore.units.Length"
                          @keydown="checkNumber($event)"
                        >
                          <template #label>
                            <span>x<sub>1</sub></span>
                          </template>
                        </v-text-field>
                      </v-col>
                      <v-col cols="12" md="6">
                        <v-text-field
                          v-model="trapezoidTo"
                          hide-details="auto"
                          :rules="spanRules"
                          :placeholder="$t('loads.wholeElement')"
                          persistent-placeholder
                          :suffix="appStore.units.Length"
                          @keydown="checkNumber($event)"
                        >
                          <template #label>
                            <span>x<sub>2</sub></span>
                          </template>
                        </v-text-field>
                      </v-col>
                    </v-row>
                  </v-col>
                </template>

                <v-col v-if="['udl', 'trapezoidal', 'concentrated'].includes(loadType)" cols="12" md="12">
                  <v-checkbox
                    v-bind="props"
                    v-model="elementLCS"
                    v-tooltip="{ text: $t('common.lcs'), location: 'left', openOnClick: !deviceHasHover }"
                    :label="`LCS`"
                    hide-details="auto"
                    :disabled="loadType === 'trapezoidal'"
                  />
                </v-col>

                <template v-if="loadType === 'temperature'">
                  <v-col cols="12" md="12">
                    <v-text-field
                      v-model="loadNodeValueTc"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="formatMeasureAsHTML(appStore.units.Temperature)"
                      @keydown="checkNumber($event)"
                    >
                      <template #label>
                        <span v-html="$t('loads.temperatureBending')"></span>
                      </template>
                    </v-text-field>
                  </v-col>
                  <v-col cols="12" md="12">
                    <v-text-field
                      v-model="loadNodeValueTbt"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="formatMeasureAsHTML(appStore.units.Temperature)"
                      @keydown="checkNumber($event)"
                    >
                      <template #label>
                        <span v-html="$t('loads.temperatureAxial')"></span>
                      </template>
                    </v-text-field>
                  </v-col>
                </template>
              </v-row>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="green darken-1" @click="addElementLoad()" @keydown.enter="addElementLoad">
          {{ $t('dialogs.addElementLoad.addElementLoad') }}
        </v-btn>
        <v-btn color="red darken-1" @click="closeModal" @keydown.enter="closeModal">{{
          $t('dialogs.common.cancel')
        }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import HelpTip from '../HelpTip.vue';
import { computed, ref, watch } from 'vue';
import { useProjectStore } from '../../store/project';
import { useAppStore } from '../../store/app';
import { closeModal } from 'jenesius-vue-modal';
import { checkNumber, executeModelMutationWithUndo, parseFloat2, numberRules } from '@/utils';
import ElementLoadPreview from '../ElementLoadPreview.vue';
import { deviceHasHover } from '@/utils/pointer';
import {
  Beam2D,
  BeamConcentratedLoad,
  BeamElementTrapezoidalEdgeLoad,
  BeamElementUniformEdgeLoad,
  BeamTemperatureLoad,
} from 'ts-fem';
import { formatMeasureAsHTML } from '@/SVGUtils';

import { useI18n } from 'vue-i18n';
const { t } = useI18n();

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = defineProps<{
  label?: string | number;
}>();

const open = ref(true);
const valid = ref(false);
const loadType = ref('udl');

const loadTypes = [
  { label: t('loadType.udl'), value: 'udl' },
  { label: t('loadType.trapezoidal'), value: 'trapezoidal' },
  { label: t('loadType.concentrated'), value: 'concentrated' },
  { label: t('loadType.temperature'), value: 'temperature' },
];

const unitAndLabel = computed(() => {
  let u = appStore.units.Force;
  let r = appStore.units.Moment;
  let l = 'F';

  if (loadType.value === 'udl' || loadType.value === 'trapezoidal') {
    u = appStore.units.ForceDistance;
    l = 'f';
  }

  return { l, u, r };
});

// TODO: LCS is forced on trapezoidal loads for now, rendering GCS load is not supported graphically
watch(loadType, (newVal) => {
  if (newVal === 'trapezoidal') {
    elementLCS.value = true;
  }
});

const loadElementId = ref(String(props.label ?? [...useProjectStore().solver.domain.elements.values()][0].label));
const loadNodeValueFx = ref(`${appStore.convertForce(0)}`);
const loadNodeValueFz = ref(`${appStore.convertForce(0)}`);
const loadNodeValueMy = ref(`${appStore.convertMoment(0)}`);
const loadTrapezoidStartFx = ref(`${appStore.convertForce(0)}`);
const loadTrapezoidStartFz = ref(`${appStore.convertForce(0)}`);
const loadTrapezoidEndFx = ref(`${appStore.convertForce(0)}`);
const loadTrapezoidEndFz = ref(`${appStore.convertForce(0)}`);
const loadNodeValueTc = ref('0.0');
const loadNodeValueTbt = ref('0.0');
const elementLoadPos = ref('0.0');
const elementLCS = ref(true);

const inverseIntensity = computed(() =>
  loadType.value === 'udl' ? appStore.convertInverseForceDistance : appStore.convertInverseForce
);

const realFx = computed(() => inverseIntensity.value(parseFloat2(loadNodeValueFx.value)));
const realFz = computed(() => appStore.vertical(inverseIntensity.value(parseFloat2(loadNodeValueFz.value))));
const realMy = computed(() => appStore.convertInverseMoment(parseFloat2(loadNodeValueMy.value)));
const realTrapStartFx = computed(() => appStore.convertInverseForceDistance(parseFloat2(loadTrapezoidStartFx.value)));
const realTrapStartFz = computed(() =>
  appStore.vertical(appStore.convertInverseForceDistance(parseFloat2(loadTrapezoidStartFz.value)))
);
const realTrapEndFx = computed(() => appStore.convertInverseForceDistance(parseFloat2(loadTrapezoidEndFx.value)));
const realTrapEndFz = computed(() =>
  appStore.vertical(appStore.convertInverseForceDistance(parseFloat2(loadTrapezoidEndFz.value)))
);
/**
 * Where the load sits on the element, as distances from its first node.
 *
 * Empty means the whole element, which is what these loads were before they could be given a
 * position - so a load nobody touches here is serialised, drawn and solved exactly as it was.
 */
const trapezoidFrom = ref('');
const trapezoidTo = ref('');

const targetLength = computed(() => {
  const element = projectStore.solver.domain.elements.get(loadElementId.value) as Beam2D | undefined;

  return element ? appStore.convertLength(element.computeGeo().l) : 0;
});

const spanRules = [
  (value: string) => {
    if (value === undefined || value === null || String(value).trim() === '') return true;

    const typed = parseFloat2(String(value));

    if (!Number.isFinite(typed)) return false;

    return (typed >= 0 && typed <= targetLength.value + 1e-9) || `0 - ${targetLength.value}`;
  },
];

/** What the model is given: a number where the box has one, and nothing where it is empty. */
const spanValue = (typed: string) =>
  String(typed).trim() === '' ? undefined : appStore.convertInverseLength(parseFloat2(String(typed)));

const realTrapFrom = computed(() => spanValue(trapezoidFrom.value));
const realTrapTo = computed(() => spanValue(trapezoidTo.value));

const realDist = computed(() => appStore.convertInverseLength(parseFloat2(elementLoadPos.value)));
const realTc = computed(() => appStore.convertInverseTemperature(parseFloat2(loadNodeValueTc.value)));
const realTbt = computed(() => appStore.convertInverseTemperature(parseFloat2(loadNodeValueTbt.value)));

const previewLoad = computed(() => {
  const domain = projectStore.solver.domain;

  if (loadType.value === 'udl') {
    return new BeamElementUniformEdgeLoad(loadElementId.value, domain, [realFx.value, realFz.value], elementLCS.value);
  }

  if (loadType.value === 'trapezoidal') {
    return new BeamElementTrapezoidalEdgeLoad(
      loadElementId.value,
      domain,
      [realTrapStartFx.value, realTrapStartFz.value],
      [realTrapEndFx.value, realTrapEndFz.value],
      elementLCS.value,
      realTrapFrom.value,
      realTrapTo.value
    );
  }

  if (loadType.value === 'concentrated') {
    return new BeamConcentratedLoad(
      loadElementId.value,
      domain,
      [realFx.value, realFz.value, realMy.value, realDist.value],
      elementLCS.value
    );
  }

  if (loadType.value === 'temperature') {
    return new BeamTemperatureLoad(loadElementId.value, domain, [realTc.value, realTbt.value, 0]);
  }

  return null;
});

const minMax = (v) => {
  const geo = target.value.computeGeo();
  if (v < 0 || v > geo.l) {
    return 'Enter value between 0 and ' + geo.l;
  }
  return true;
};

const addElementLoad = () => {
  if (valid.value === false) return;

  executeModelMutationWithUndo(() => {
    useProjectStore().solver.loadCases[0].solved = false;

    if (loadType.value === 'udl')
      useProjectStore().solver.loadCases[0].createBeamElementUniformEdgeLoad(
        loadElementId.value,
        [realFx.value, realFz.value],
        elementLCS.value
      );

    if (loadType.value === 'trapezoidal')
      useProjectStore().solver.loadCases[0].createBeamElementTrapezoidalEdgeLoad(
        loadElementId.value,
        [realTrapStartFx.value, realTrapStartFz.value],
        [realTrapEndFx.value, realTrapEndFz.value],
        elementLCS.value,
        realTrapFrom.value,
        realTrapTo.value
      );

    if (loadType.value === 'concentrated')
      useProjectStore().solver.loadCases[0].createBeamConcentratedLoad(
        loadElementId.value,
        [realFx.value, realFz.value, realMy.value, realDist.value],
        elementLCS.value
      );

    if (loadType.value === 'temperature')
      useProjectStore().solver.loadCases[0].createBeamTemperatureLoad(loadElementId.value, [
        realTc.value,
        realTbt.value,
        0,
      ]);
  });

  projectStore.clearSelection();
  closeModal();
};

const target = computed(() => {
  return useProjectStore().solver.domain.elements.get(loadElementId.value)!;
});

// default concentrated load position to mid-span
watch(loadType, () => {
  if (loadType.value === 'concentrated') {
    const geo = target.value.computeGeo();
    elementLoadPos.value = `${appStore.convertLength(Math.max(Math.min(Math.floor(geo.l / 2), 5.0), geo.l / 10))}`;
  }
});
</script>
