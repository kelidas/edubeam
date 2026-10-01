<template>
  <v-dialog v-model="open" max-width="420">
    <v-card>
      <v-card-title> {{ $t('dialogs.editNodalLoad.editNodalLoad') }} </v-card-title>

      <v-card-text>
        <v-form v-model="valid">
          <NodalLoadFields
            ref="formRef"
            v-model:node-id="loadNodeId"
            v-model:load-type="loadType"
            :disable-node-select="true"
          />
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="green darken-1" @click="editNodalLoad()" @keydown.enter="editNodalLoad">
          {{ $t('dialogs.editNodalLoad.editNodalLoad') }}
        </v-btn>
        <v-btn color="red darken-1" @click="closeModal()" @keydown.enter="closeModal">{{
          $t('dialogs.common.cancel')
        }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useProjectStore } from '../../store/project';
import { closeModal } from 'jenesius-vue-modal';
import { executeModelMutationWithUndo } from '../../utils';
import NodalLoadFields from './NodalLoadFields.vue';
import type { NodalLoadKind } from './NodalLoadForm';

const projectStore = useProjectStore();

const props = withDefaults(
  defineProps<{
    index: number;
    type?: NodalLoadKind;
  }>(),
  {
    type: 'force',
  }
);

const open = ref(true);
const valid = ref(false);
const formRef = ref<InstanceType<typeof NodalLoadFields> | null>(null);

const loadType = ref<NodalLoadKind>(props.type);

const load = computed(() =>
  props.type === 'displacement'
    ? projectStore.loadCase.prescribedBC[props.index]
    : projectStore.loadCase.nodalLoadList[props.index]
);
const loadNodeId = computed(() => load.value.target);

onMounted(() => formRef.value?.setFromLoad(load.value));

const editNodalLoad = () => {
  if (valid.value === false || !formRef.value) return;

  executeModelMutationWithUndo(() => {
    formRef.value!.applyToLoad(load.value);
  });

  projectStore.solve();
  projectStore.clearSelection();
  closeModal();
};
</script>
