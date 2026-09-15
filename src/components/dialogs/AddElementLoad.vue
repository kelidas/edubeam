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
        />
        <v-form v-model="valid">
          <ElementLoadFields ref="formRef" v-model:element-id="loadElementId" v-model:load-type="loadType" />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="green darken-1" @click="addElementLoad" @keydown.enter="addElementLoad">
          {{ $t('dialogs.addElementLoad.addElementLoad') }}
        </v-btn>
        <v-btn color="red darken-1" @click="closeModal" @keydown.enter="closeModal">
          {{ $t('dialogs.common.cancel') }}
        </v-btn>
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
import { executeModelMutationWithUndo } from '@/utils';
import { useI18n } from 'vue-i18n';
import ElementLoadFields from './ElementLoadFields.vue';

const { t } = useI18n();
const projectStore = useProjectStore();

const props = defineProps<{ label?: string | number }>();

const open = ref(true);
const valid = ref(false);
const loadType = ref('udl');
const loadElementId = ref(String(props.label ?? [...projectStore.solver.domain.elements.values()][0].label));

const appStore = useAppStore();

const formRef = ref<InstanceType<typeof ElementLoadFields> | null>(null);

/**
 * An imposed deformation exists to solve influence lines and is not a load anyone puts on a
 * structure, so the load case viewer does not offer it. The influence workspace reaches it through
 * its own dialog; the list stays conditional rather than trimmed so this one still works if it is
 * ever opened there.
 */
const loadTypes = computed(() => [
  { label: t('loadType.udl'), value: 'udl' },
  { label: t('loadType.trapezoidal'), value: 'trapezoidal' },
  { label: t('loadType.concentrated'), value: 'concentrated' },
  ...(appStore.workspace === 'influence'
    ? [{ label: t('loadType.concentrated_deformation'), value: 'concentrated_deformation' }]
    : []),
  { label: t('loadType.temperature'), value: 'temperature' },
]);

watch(loadType, (newVal) => {
  if (!formRef.value) return;
  if (newVal === 'trapezoidal') formRef.value.lcs = true;
  if (['concentrated', 'concentrated_deformation'].includes(newVal)) formRef.value.resetPositionToDefault();
});

const addElementLoad = () => {
  if (!valid.value || !formRef.value) return;
  const form = formRef.value;

  executeModelMutationWithUndo(() => {
    // added to the case the workspace is about, which is where it will be looked for again
    const loadCase = projectStore.loadCase;

    loadCase.solved = false;
    form.createLoad(loadCase, loadElementId.value);
  });

  projectStore.clearSelection();
  closeModal();
};
</script>
