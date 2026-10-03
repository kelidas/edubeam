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
          <NodalLoadFields ref="formRef" v-model:node-id="loadNodeId" v-model:load-type="loadType" />
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
import { closeModal } from 'jenesius-vue-modal';
import { useAppStore } from '@/store/app';
import { executeModelMutationWithUndo } from '@/utils';
import { i18n } from '@/plugins/i18n';
import NodalLoadFields from './NodalLoadFields.vue';
import type { NodalLoadKind } from './NodalLoadForm';

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = withDefaults(
  defineProps<{
    label?: string | number;
    type?: NodalLoadKind;
  }>(),
  {
    label: undefined,
    type: 'force',
  }
);

const open = ref(true);
const valid = ref(false);

const loadType = ref<NodalLoadKind>('force');
const nodes = projectStore.solver.domain.nodes;
const firstNodeLabel = nodes.size > 0 ? [...nodes.values()][0].label : undefined;
const loadNodeId = ref(props.label != null && nodes.has(props.label) ? props.label : firstNodeLabel);

const formRef = ref<InstanceType<typeof NodalLoadFields> | null>(null);

const selectedNode = computed(() => nodes.get(loadNodeId.value));
/** DOFs supported (constrained) at the target node - only those can carry a prescribed displacement. */
const nodeBcs = computed<Set<number>>(() => selectedNode.value?.bcs ?? new Set());

watch(loadNodeId, () => {
  // ...except in the influence workspace, where a force is not on offer at all
  if (nodeBcs.value.size === 0 && appStore.workspace !== 'influence') {
    loadType.value = 'force';
  }
});

onMounted(() => {
  if (props.type === 'displacement' || appStore.workspace === 'influence') {
    loadType.value = 'displacement';
  }
});

const addNodalLoad = () => {
  if (valid.value === false || !selectedNode.value || !formRef.value) return;

  // The influence lines tab keeps several unit dislocations at one support - one for each reaction
  // whose line is wanted - and switches between them; a structure has one settlement per node.
  if (loadType.value !== 'force' && appStore.workspace !== 'influence') {
    // check if the node already has a prescribed displacement
    for (const load of projectStore.loadCase.prescribedBC) {
      if (load.target === loadNodeId.value) {
        alert(i18n.global.t('warnings.prescribedDisplacementExists'));
        closeModal();
        return;
      }
    }
  }

  executeModelMutationWithUndo(() => {
    projectStore.loadCase.solved = false;
    formRef.value!.createLoad(projectStore.loadCase, loadNodeId.value);
  });

  projectStore.clearSelection();
  closeModal();
};
</script>
