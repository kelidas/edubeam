<template>
  <v-dialog v-model="open" max-width="420">
    <v-card>
      <v-card-title class="d-flex align-center">
        <span>{{ $t('dialogs.addNodalLoad.addNewNodalLoad') }}</span>
        <HelpTip topic="nodalLoads" class="ml-1" />
      </v-card-title>

      <div>
        <!-- Influence lines are made of support displacements; a force has no place there -->
        <v-radio-group
          v-if="appStore.workspace !== 'influence'"
          v-model="loadType"
          inline
          density="compact"
          class="mx-3"
        >
          <v-radio :label="$t('loads.forceMoment')" value="force"></v-radio>
          <v-radio
            :label="$t('loads.prescribedDisplacement')"
            value="displacement"
            :disabled="nodeBcs.size === 0"
          ></v-radio>
        </v-radio-group>
        <v-form v-model="valid">
          <v-container>
            <v-row no-gutters>
              <v-col cols="6" align-self="center">
                <div class="d-flex justify-center">
                  <Vector2DHelper
                    :fx="loadType === 'force' ? realFx : realDx"
                    :fz="loadType === 'force' ? realFz : realDz"
                    :my="loadType === 'force' ? realMy : realRy"
                    :type="loadType === 'force' ? 'force' : 'displacement'"
                    :label="loadNodeId"
                  />
                </div>
              </v-col>

              <v-col cols="6">
                <v-row no-gutters>
                  <v-col cols="12">
                    <v-select
                      v-model="loadNodeId"
                      :items="projectStore.nodes"
                      item-title="label"
                      item-value="label"
                      :label="$t('common.node')"
                      hide-details="auto"
                      required
                      autofocus
                    />
                  </v-col>
                  <v-col cols="12">
                    <v-text-field
                      v-model="loadNodeValueFx"
                      :label="`${mainLabel}x`"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="mainUnits"
                      :disabled="loadType === 'displacement' && !nodeBcs.has(DofID.Dx)"
                      @keydown="checkNumber($event)"
                    ></v-text-field>
                  </v-col>

                  <v-col cols="12">
                    <v-text-field
                      v-model="loadNodeValueFz"
                      :label="`${mainLabel}z`"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="mainUnits"
                      :disabled="loadType === 'displacement' && !nodeBcs.has(DofID.Dz)"
                      @keydown="checkNumber($event)"
                    ></v-text-field>
                  </v-col>

                  <v-col cols="12">
                    <v-text-field
                      v-model="loadNodeValueMy"
                      :label="`${momentLabel}y`"
                      hide-details="auto"
                      :rules="numberRules"
                      :suffix="`${momentUnits}`"
                      :disabled="loadType === 'displacement' && !nodeBcs.has(DofID.Ry)"
                      @keydown="checkNumber($event)"
                    >
                    </v-text-field>
                  </v-col>
                </v-row>
              </v-col>
            </v-row>
          </v-container>
        </v-form>
      </div>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="green darken-1" @click="addNodalLoad()" @keydown.enter="addNodalLoad()">
          {{ $t('dialogs.addNodalLoad.addNodalLoad') }}
        </v-btn>
        <v-btn color="red darken-1" @click="closeModal()" @keydown.enter="closeModal">{{
          $t('dialogs.common.cancel')
        }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import HelpTip from '../HelpTip.vue';
import { ref, computed, onMounted, watch } from 'vue';
import { useProjectStore } from '../../store/project';
import { DofID } from 'ts-fem';
import { closeModal } from 'jenesius-vue-modal';
import { useAppStore } from '@/store/app';
import { checkNumber, executeModelMutationWithUndo, parseFloat2, numberRules } from '@/utils';
import Vector2DHelper from '../Vector2DHelper.vue';

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = withDefaults(
  defineProps<{
    label?: string | number;
    type?: 'force' | 'displacement';
  }>(),
  {
    label: undefined,
    type: 'force',
  }
);

const open = ref(true);
const valid = ref(false);

const loadType = ref('force');
const nodes = projectStore.solver.domain.nodes;
const firstNodeLabel = nodes.size > 0 ? [...nodes.values()][0].label : undefined;
const loadNodeId = ref(props.label != null && nodes.has(props.label) ? props.label : firstNodeLabel);

const selectedNode = computed(() => nodes.get(loadNodeId.value));
const nodeBcs = computed<Set<number>>(() => selectedNode.value?.bcs ?? new Set());
const loadNodeValueFx = ref(`${appStore.convertForce(0)}`);
const loadNodeValueFz = ref(`${appStore.convertForce(0)}`);
const loadNodeValueMy = ref('0');

watch(loadNodeId, () => {
  // ...except in the influence workspace, where a force is not on offer at all
  if (nodeBcs.value.size === 0 && appStore.workspace !== 'influence') {
    loadType.value = 'force';
  }
});

const mainLabel = computed(() => (loadType.value === 'force' ? 'F' : 'D'));
const momentLabel = computed(() => (loadType.value === 'force' ? 'M' : 'R'));

const mainUnits = computed(() => (loadType.value === 'force' ? appStore.units.Force : appStore.units.Length));
const momentUnits = computed(() => (loadType.value === 'force' ? appStore.units.Moment : 'rad'));

const realFx = computed(() => appStore.convertInverseForce(parseFloat2(loadNodeValueFx.value)));
const realFz = computed(() => appStore.convertInverseForce(parseFloat2(loadNodeValueFz.value)));
const realMy = computed(() => appStore.convertInverseMoment(parseFloat2(loadNodeValueMy.value)));

const realDx = computed(() => appStore.convertInverseLength(parseFloat2(loadNodeValueFx.value)));
const realDz = computed(() => appStore.convertInverseLength(parseFloat2(loadNodeValueFz.value)));
const realRy = computed(() => parseFloat2(loadNodeValueMy.value));

onMounted(() => {
  if (props.type === 'displacement' || appStore.workspace === 'influence') {
    loadType.value = 'displacement';
  }
});

const addNodalLoad = () => {
  if (valid.value === false || !selectedNode.value) return;

  // The influence lines tab keeps several unit dislocations at one support - one for each reaction
  // whose line is wanted - and switches between them; a structure has one settlement per node.
  if (loadType.value !== 'force' && appStore.workspace !== 'influence') {
    // check if the node already has a prescribed displacement
    for (const load of projectStore.loadCase.prescribedBC) {
      if (load.target === loadNodeId.value) {
        alert('Prescribed displacement already exists for this node. Please remove it first.');
        closeModal();
        return;
      }
    }
  }

  executeModelMutationWithUndo(() => {
    useProjectStore().loadCase.solved = false;

    if (loadType.value === 'force') {
      useProjectStore().loadCase.createNodalLoad(loadNodeId.value, {
        [DofID.Dx]: realFx.value,
        [DofID.Dz]: realFz.value,
        [DofID.Ry]: realMy.value,
      });
    } else {
      useProjectStore().loadCase.createPrescribedDisplacement(loadNodeId.value, {
        [DofID.Dx]: realDx.value,
        [DofID.Dz]: realDz.value,
        [DofID.Ry]: realRy.value,
      });
    }
  });

  projectStore.clearSelection();
  closeModal();
};
</script>
