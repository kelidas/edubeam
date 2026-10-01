<template>
  <v-row no-gutters>
    <v-col cols="6" align-self="center">
      <div class="d-flex justify-center">
        <Vector2DHelper
          :fx="realFx"
          :fz="realFz"
          :my="realMy"
          :type="loadType === 'force' ? 'force' : 'displacement'"
          :label="nodeId"
        />
      </div>
    </v-col>

    <v-col cols="6">
      <v-row no-gutters>
        <v-col cols="12">
          <v-select
            v-model="nodeId"
            :items="projectStore.nodes"
            item-title="label"
            item-value="label"
            :label="$t('common.node')"
            hide-details="auto"
            required
            :disabled="disableNodeSelect"
            :autofocus="disableNodeSelect"
          />
        </v-col>
        <v-col cols="12">
          <v-text-field
            v-model="fx"
            :label="`${mainLabel}x`"
            hide-details="auto"
            :rules="numberRules"
            :suffix="mainUnits"
            :disabled="loadType === 'displacement' && !nodeBcs.has(DofID.Dx)"
            @keydown="checkNumber($event)"
          />
        </v-col>

        <v-col cols="12">
          <v-text-field
            v-model="fz"
            :label="`${mainLabel}${appStore.axes.v}`"
            hide-details="auto"
            :rules="numberRules"
            :suffix="mainUnits"
            :disabled="loadType === 'displacement' && !nodeBcs.has(DofID.Dz)"
            @keydown="checkNumber($event)"
          />
        </v-col>

        <v-col cols="12">
          <v-text-field
            v-model="my"
            :label="`${momentLabel}${appStore.axes.r}`"
            hide-details="auto"
            :rules="numberRules"
            :suffix="momentUnits"
            :disabled="loadType === 'displacement' && !nodeBcs.has(DofID.Ry)"
            @keydown="checkNumber($event)"
          />
        </v-col>
      </v-row>
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import { DofID } from 'ts-fem';
import { checkNumber, numberRules } from '@/utils';
import Vector2DHelper from '../Vector2DHelper.vue';
import { useNodalLoadForm, type NodalLoadKind } from '@/components/dialogs/NodalLoadForm';

const nodeId = defineModel<string | number>('nodeId', { required: true });
const loadType = defineModel<NodalLoadKind>('loadType', { required: true });

defineProps<{
  disableNodeSelect?: boolean;
}>();

const {
  appStore,
  projectStore,
  nodeBcs,
  mainLabel,
  momentLabel,
  mainUnits,
  momentUnits,
  fx,
  fz,
  my,
  realFx,
  realFz,
  realMy,
  setFromLoad,
  applyToLoad,
  createLoad,
} = useNodalLoadForm(loadType, nodeId);

defineExpose({ nodeBcs, setFromLoad, applyToLoad, createLoad });
</script>
