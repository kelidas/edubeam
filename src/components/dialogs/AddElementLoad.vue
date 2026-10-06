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
import { computed, onMounted, ref, watch } from 'vue';
import { useProjectStore } from '../../store/project';
import { useAppStore } from '../../store/app';
import { closeModal } from 'jenesius-vue-modal';
import { executeModelMutationWithUndo } from '@/utils';
import { useI18n } from 'vue-i18n';
import ElementLoadFields from './ElementLoadFields.vue';

const { t } = useI18n();
const projectStore = useProjectStore();

const props = defineProps<{ label?: string | number }>();

const appStore = useAppStore();

const open = ref(true);
const valid = ref(false);
/** The influence workspace is only ever about imposed deformations, so it opens on one. */
const loadType = ref(appStore.workspace === 'influence' ? 'concentrated_deformation' : 'udl');
const loadElementId = ref(String(props.label ?? [...projectStore.solver.domain.elements.values()][0].label));

const formRef = ref<InstanceType<typeof ElementLoadFields> | null>(null);

/**
 * An imposed deformation exists to solve influence lines and is not a load anyone puts on a
 * structure, so it is offered only in the workspace that is about influence lines - which is also
 * the workspace this dialog opens on it in.
 */
const loadTypes = computed(() =>
  appStore.workspace === 'influence'
    ? [{ label: t('loadType.concentrated_deformation'), value: 'concentrated_deformation' }]
    : [
        { label: t('loadType.udl'), value: 'udl' },
        { label: t('loadType.trapezoidal'), value: 'trapezoidal' },
        { label: t('loadType.concentrated'), value: 'concentrated' },
        { label: t('loadType.temperature'), value: 'temperature' },
      ]
);

watch(loadType, (newVal) => {
  if (!formRef.value) return;
  if (newVal === 'trapezoidal') formRef.value.lcs = true;
  formRef.value.applyTypeDefaults();
});

// the influence workspace opens straight on a deformation, which never passes through the watch
onMounted(() => formRef.value?.applyTypeDefaults());

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
