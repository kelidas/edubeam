<template>
  <v-dialog v-model="open" max-width="520" attach=".v-application">
    <v-card>
      <v-card-title>{{ $t('dialogs.editElementLoad.editElementLoad') }}</v-card-title>
      <v-card-subtitle>{{ $t('loadType.' + loadType) }}</v-card-subtitle>
      <v-card-text>
        <v-form v-model="valid">
          <ElementLoadFields
            ref="formRef"
            v-model:element-id="elementId"
            v-model:load-type="loadType"
            :disable-element-select="true"
          />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="green darken-1" @click="editElementLoad" @keydown.enter="editElementLoad">
          {{ $t('dialogs.editElementLoad.editElementLoad') }}
        </v-btn>
        <v-btn color="red darken-1" @click="closeModal" @keydown.enter="closeModal">
          {{ $t('dialogs.common.cancel') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useProjectStore } from '@/store/project';
import { closeModal } from 'jenesius-vue-modal';
import { loadType as LT } from '@/utils';
import ElementLoadFields from './ElementLoadFields.vue';

const props = defineProps<{ index: number }>();

const projectStore = useProjectStore();

const open = ref(true);
const valid = ref(false);
const formRef = ref<InstanceType<typeof ElementLoadFields> | null>(null);

// the case the workspace is about: an imposed deformation made for an influence line is in its
const load = computed(() => projectStore.loadCase.elementLoadList[props.index]);
const elementId = computed(() => load.value.target);
const loadType = computed(() => LT(load.value));

watch(loadType, (newVal) => {
  if (newVal === 'trapezoidal' && formRef.value) {
    formRef.value.lcs = true;
  }
});

onMounted(() => {
  formRef.value?.setFromLoad(load.value);
});

const editElementLoad = () => {
  if (!valid.value || !formRef.value) return;

  formRef.value.applyToLoad(load.value);

  projectStore.solve();
  projectStore.clearSelection();
  closeModal();
};
</script>
