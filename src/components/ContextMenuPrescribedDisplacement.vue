<script setup lang="ts">
import { openModal } from 'jenesius-vue-modal';
import EditNodalLoadDialog from './dialogs/EditNodalLoad.vue';
import { deletePrescribedDisplacement, executeModelMutationWithUndo, setUnsolved, solve } from '@/utils';
import { useProjectStore } from '@/store/project';
import { computed } from 'vue';

const projectStore = useProjectStore();

/** The one picked, in the case the open tab is about - the same switch as the loads table's. */
const load = computed(() => {
  if (projectStore.selection.label === null) return null;

  const index = Number(projectStore.selection.label);
  return Number.isNaN(index) ? null : (projectStore.loadCase.prescribedBC[index] ?? null);
});

const toggleActive = () => {
  const target = load.value;
  if (!target) return;

  executeModelMutationWithUndo(() => {
    setUnsolved();
    target.active = !target.active;
  });

  solve();
  projectStore.selection.type = null;
};

const removePrescribedDisplacement = () => {
  if (projectStore.selection.label === null) return;

  const index = Number(projectStore.selection.label);
  if (Number.isNaN(index)) return;

  /*
   * The case the workspace is about, not the first one. A prescribed displacement made in the
   * influence line workspace belongs to its case, and the deletion removes from the active one - so
   * looking it up here in the first found nothing there to delete, and nothing was deleted.
   */
  const selectedLoad = projectStore.loadCase.prescribedBC[index];
  if (!selectedLoad) return;

  deletePrescribedDisplacement(selectedLoad);
  projectStore.selection.type = null;
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
    <v-list-item v-if="load" link class="text-body-2" @click="toggleActive">
      <template #prepend>
        <div class="pr-2">
          <v-icon size="16" :icon="load.active ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" />
        </div>
      </template>
      {{ load.active ? $t('loads.switchOff') : $t('loads.switchOn') }}
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
