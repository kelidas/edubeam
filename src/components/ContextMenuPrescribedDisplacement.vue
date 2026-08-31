<script setup lang="ts">
import { openModal } from 'jenesius-vue-modal';
import EditNodalLoadDialog from './dialogs/EditNodalLoad.vue';
import { deletePrescribedDisplacement } from '@/utils';
import { useProjectStore } from '@/store/project';

const projectStore = useProjectStore();

const removePrescribedDisplacement = () => {
  if (projectStore.selection.label === null) return;

  const index = Number(projectStore.selection.label);
  if (Number.isNaN(index)) return;

  const selectedLoad = projectStore.solver.loadCases[0].prescribedBC[index];
  if (!selectedLoad) return;

  deletePrescribedDisplacement(selectedLoad);
};
</script>

<template>
  <v-list density="compact" class="py-0">
    <v-list-item
      link
      class="text-body-2"
      @click="
        openModal(EditNodalLoadDialog, { index: projectStore.selection.label, type: 'displacement' });
        projectStore.selection.type = null;
      "
    >
      <template #prepend>
        <div class="pr-2"><v-icon size="16" icon="mdi-pencil" /></div>
      </template>
      {{ $t('loads.editLoad') }}
    </v-list-item>
    <v-divider />
    <v-list-item link class="text-body-2 text-error" @click="removePrescribedDisplacement">
      <template #prepend>
        <div class="pr-2"><v-icon size="16" color="error" icon="mdi-delete" /></div>
      </template>
      {{ $t('common.delete') }}
    </v-list-item>
  </v-list>
</template>
