<template>
  <v-row no-gutters>
    <v-col v-if="previewLoad" cols="12" md="6" class="mb-4 mb-md-0 pe-md-4" align-self="center">
      <ElementLoadPreview class="w-100 pointer-events-none" :load="previewLoad" :show-node-labels="true" />
    </v-col>
    <v-col cols="12" :md="previewLoad ? 6 : 12" align-self="center">
      <v-row no-gutters>
        <v-col cols="12" md="12">
          <v-select
            v-model="elementId"
            :items="projectStore.beams"
            item-title="label"
            item-value="label"
            :label="$t('common.element')"
            hide-details="auto"
            required
            :disabled="disableElementSelect"
            :autofocus="disableElementSelect"
          />
        </v-col>

        <template v-if="['udl', 'concentrated', 'concentrated_deformation'].includes(loadType)">
          <v-col cols="12" md="12">
            <v-text-field
              v-model="fx"
              :label="labelX"
              hide-details="auto"
              :rules="numberRules"
              :suffix="mainUnits"
              @keydown="checkNumber($event)"
            />
          </v-col>

          <v-col cols="12" md="12">
            <v-text-field
              v-model="fz"
              :label="labelZ"
              hide-details="auto"
              :rules="numberRules"
              :suffix="mainUnits"
              @keydown="checkNumber($event)"
            />
          </v-col>

          <v-col v-if="['concentrated', 'concentrated_deformation'].includes(loadType)" cols="12" md="12">
            <v-text-field
              v-model="my"
              :label="labelMy"
              hide-details="auto"
              :rules="numberRules"
              :suffix="momentUnits"
              @keydown="checkNumber($event)"
            />
          </v-col>

          <v-col v-if="['concentrated', 'concentrated_deformation'].includes(loadType)" cols="12" md="12">
            <v-text-field
              v-model="position"
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
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="trapStartFx"
                  hide-details="auto"
                  :rules="numberRules"
                  :suffix="mainUnits"
                  @keydown="checkNumber($event)"
                >
                  <template #label><span>f<sub>1</sub>x</span></template>
                </v-text-field>
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="trapEndFx"
                  hide-details="auto"
                  :rules="numberRules"
                  :suffix="mainUnits"
                  @keydown="checkNumber($event)"
                >
                  <template #label><span>f<sub>2</sub>x</span></template>
                </v-text-field>
              </v-col>
            </v-row>
          </v-col>
          <v-col cols="12">
            <v-row no-gutters>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="trapStartFz"
                  hide-details="auto"
                  :rules="numberRules"
                  :suffix="mainUnits"
                  @keydown="checkNumber($event)"
                >
                  <template #label><span>f<sub>1</sub>z</span></template>
                </v-text-field>
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="trapEndFz"
                  hide-details="auto"
                  :rules="numberRules"
                  :suffix="mainUnits"
                  @keydown="checkNumber($event)"
                >
                  <template #label><span>f<sub>2</sub>z</span></template>
                </v-text-field>
              </v-col>
            </v-row>
          </v-col>
          <!--
            Where the load sits on the element, as distances from its first node. Left empty it
            covers the whole element, which is what a trapezoidal load has always been; a uniform
            load over part of an element is this with the same value typed twice.
          -->
          <v-col cols="12">
            <v-row no-gutters>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="trapFrom"
                  hide-details="auto"
                  :rules="[minMax]"
                  :placeholder="$t('loads.wholeElement')"
                  persistent-placeholder
                  :suffix="appStore.units.Length"
                  @keydown="checkNumber($event)"
                >
                  <template #label
                    ><span>x<sub>1</sub></span></template
                  >
                </v-text-field>
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field
                  v-model="trapTo"
                  hide-details="auto"
                  :rules="[minMax]"
                  :placeholder="$t('loads.wholeElement')"
                  persistent-placeholder
                  :suffix="appStore.units.Length"
                  @keydown="checkNumber($event)"
                >
                  <template #label
                    ><span>x<sub>2</sub></span></template
                  >
                </v-text-field>
              </v-col>
            </v-row>
          </v-col>
        </template>

        <v-col
          v-if="['udl', 'trapezoidal', 'concentrated', 'concentrated_deformation'].includes(loadType)"
          cols="12"
          md="12"
        >
          <v-checkbox
            v-model="lcs"
            v-tooltip="{ text: $t('common.lcs'), location: 'left', openOnClick: !deviceHasHover }"
            label="LCS"
            hide-details="auto"
            :disabled="loadType === 'trapezoidal'"
          />
        </v-col>

        <template v-if="loadType === 'temperature'">
          <v-col cols="12" md="12">
            <v-text-field
              v-model="tc"
              hide-details="auto"
              :rules="numberRules"
              :suffix="formatMeasureAsHTML(appStore.units.Temperature)"
              @keydown="checkNumber($event)"
            >
              <template #label><span v-html="$t('loads.temperatureBending')"></span></template>
            </v-text-field>
          </v-col>
          <v-col cols="12" md="12">
            <v-text-field
              v-model="tbt"
              hide-details="auto"
              :rules="numberRules"
              :suffix="formatMeasureAsHTML(appStore.units.Temperature)"
              @keydown="checkNumber($event)"
            >
              <template #label><span v-html="$t('loads.temperatureAxial')"></span></template>
            </v-text-field>
          </v-col>
        </template>
      </v-row>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { checkNumber, numberRules } from '@/utils';
import { formatMeasureAsHTML } from '@/SVGUtils';
import ElementLoadPreview from '../ElementLoadPreview.vue';
import { deviceHasHover } from '@/utils/pointer';
import { useElementLoadForm } from '@/components/dialogs/ElementLoadForm';

const elementId = defineModel<string>('elementId', { required: true });
const loadType = defineModel<string>('loadType', { required: true });

defineProps<{
  disableElementSelect?: boolean;
}>();

const {
  appStore,
  projectStore,
  labelX,
  labelZ,
  labelMy,
  mainUnits,
  momentUnits,
  minMax,
  fx,
  fz,
  my,
  trapStartFx,
  trapStartFz,
  trapEndFx,
  trapEndFz,
  trapFrom,
  trapTo,
  tc,
  tbt,
  position,
  lcs,
  previewLoad,
  applyTypeDefaults,
  setFromLoad,
  applyToLoad,
  createLoad,
} = useElementLoadForm(loadType, elementId);

defineExpose({ lcs, applyTypeDefaults, setFromLoad, applyToLoad, createLoad });
</script>
