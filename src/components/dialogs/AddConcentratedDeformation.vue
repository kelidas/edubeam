<template>
  <v-dialog v-model="open" max-width="420">
    <v-card>
      <v-card-title> {{ $t('loadType.concentrated_deformation') }} </v-card-title>

      <v-card-text>
        <v-form v-model="valid">
          <v-container>
            <v-row no-gutters>
              <v-col cols="12">
                <v-select
                  v-model="targetElement"
                  :items="projectStore.beams"
                  item-title="label"
                  item-value="label"
                  :label="$t('common.element')"
                  hide-details="auto"
                  required
                  autofocus
                />
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="valueDu"
                  hide-details="auto"
                  :rules="numberRules"
                  :suffix="appStore.units.Length"
                  @keydown="checkNumber($event)"
                >
                  <template #label>&Delta;u</template>
                </v-text-field>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="valueDw"
                  hide-details="auto"
                  :rules="numberRules"
                  :suffix="appStore.units.Length"
                  @keydown="checkNumber($event)"
                >
                  <template #label>&Delta;w</template>
                </v-text-field>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="valueDphi"
                  hide-details="auto"
                  :rules="numberRules"
                  suffix="rad"
                  @keydown="checkNumber($event)"
                >
                  <template #label>&Delta;&phi;</template>
                </v-text-field>
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="valuePosition"
                  label="x"
                  hide-details="auto"
                  :rules="[...numberRules, positionInside]"
                  :suffix="appStore.units.Length"
                  @keydown="checkNumber($event)"
                ></v-text-field>
              </v-col>
            </v-row>
          </v-container>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="green darken-1" @click="addDeformation()" @keydown.enter="addDeformation()">
          {{ $t('common.addNew') }}
        </v-btn>
        <v-btn color="red darken-1" @click="closeModal()" @keydown.enter="closeModal">{{
          $t('dialogs.common.cancel')
        }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { useProjectStore } from '../../store/project';
import { Beam2D } from 'ts-fem';
import { closeModal } from 'jenesius-vue-modal';
import { useAppStore } from '@/store/app';
import { checkNumber, executeModelMutationWithUndo, parseFloat2, numberRules, setUnsolved } from '@/utils';

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = withDefaults(
  defineProps<{
    label?: string | number;
  }>(),
  {
    label: undefined,
  }
);

const open = ref(true);
const valid = ref(false);

const firstBeam = projectStore.beams[0]?.label;
const targetElement = ref(
  props.label != null && projectStore.solver.domain.elements.has(props.label) ? props.label : firstBeam
);

// A unit rotation dislocation is the everyday case: the Muller-Breslau influence line for M
const valueDu = ref('0');
const valueDw = ref('0');
const valueDphi = ref('1');
const valuePosition = ref('0');

const targetLength = computed(() => {
  const beam = projectStore.solver.domain.elements.get(targetElement.value) as Beam2D | undefined;
  return beam ? beam.computeGeo().l : 0;
});

const positionInside = (v: string) => {
  const x = appStore.convertInverseLength(parseFloat2(v));
  if (x < 0 || x > targetLength.value) {
    return `Enter a value between 0 and ${appStore.convertLength(targetLength.value)}`;
  }
  return true;
};

const addDeformation = () => {
  if (valid.value === false || targetElement.value == null) return;

  executeModelMutationWithUndo(() => {
    setUnsolved();
    // The dislocations live in the influence line case, never with the real loads
    useProjectStore()
      .influenceLoadCase()
      .createBeamConcentratedDeformation(
        targetElement.value,
        [
          appStore.convertInverseLength(parseFloat2(valueDu.value)),
          appStore.convertInverseLength(parseFloat2(valueDw.value)),
          parseFloat2(valueDphi.value),
          appStore.convertInverseLength(parseFloat2(valuePosition.value)),
        ],
        true
      );
  });

  projectStore.clearSelection();
  closeModal();
};
</script>
