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
                  disabled
                />
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="valueDu"
                  hide-details="auto"
                  :rules="numberRules"
                  :suffix="appStore.units.Length"
                  autofocus
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
                  :rules="numberRules"
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
        <v-btn color="green darken-1" @click="editDeformation()" @keydown.enter="editDeformation">
          {{ $t('loads.editLoad') }}
        </v-btn>
        <v-btn color="red darken-1" @click="closeModal()" @keydown.enter="closeModal">{{
          $t('dialogs.common.cancel')
        }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from '../../store/project';
import { BeamConcentratedDeformation } from 'ts-fem';
import { closeModal } from 'jenesius-vue-modal';
import { useAppStore } from '@/store/app';
import { checkNumber, executeModelMutationWithUndo, parseFloat2, numberRules, setUnsolved } from '@/utils';

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = defineProps<{
  index: number;
}>();

const open = ref(true);
const valid = ref(false);

const load = () => projectStore.influenceLoadCase().elementLoadList[props.index] as BeamConcentratedDeformation;

const targetElement = ref<string | number>('');
const valueDu = ref('0');
const valueDw = ref('0');
const valueDphi = ref('0');
const valuePosition = ref('0');

onMounted(() => {
  const l = load();
  if (!l) return;

  targetElement.value = l.target;
  valueDu.value = appStore.convertLength(l.values[0]).toString();
  valueDw.value = appStore.convertLength(l.values[1]).toString();
  valueDphi.value = l.values[2].toString();
  valuePosition.value = appStore.convertLength(l.values[3]).toString();
});

const editDeformation = () => {
  if (valid.value === false) return;

  executeModelMutationWithUndo(() => {
    setUnsolved();
    const l = load();
    l.values[0] = appStore.convertInverseLength(parseFloat2(valueDu.value));
    l.values[1] = appStore.convertInverseLength(parseFloat2(valueDw.value));
    l.values[2] = parseFloat2(valueDphi.value);
    l.values[3] = appStore.convertInverseLength(parseFloat2(valuePosition.value));
  });

  projectStore.clearSelection();
  closeModal();
};
</script>
