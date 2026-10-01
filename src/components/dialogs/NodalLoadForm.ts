import { ref, computed, type Ref } from 'vue';
import { DofID, type LoadCase, type NodalLoad, type PrescribedDisplacement } from 'ts-fem';
import { useAppStore } from '@/store/app';
import { useProjectStore } from '@/store/project';
import { parseFloat2 } from '@/utils';

export type NodalLoadKind = 'force' | 'displacement';

export function useNodalLoadForm(loadTypeRef: Ref<NodalLoadKind>, nodeIdRef: Ref<string | number | undefined>) {
  const appStore = useAppStore();
  const projectStore = useProjectStore();

  const selectedNode = computed(() => projectStore.solver.domain.nodes.get(nodeIdRef.value));
  /** DOFs supported (constrained) at the target node - only those can carry a prescribed displacement. */
  const nodeBcs = computed<Set<number>>(() => selectedNode.value?.bcs ?? new Set());

  // Every input holds a string in display units; the `real*` computeds below are the model (SI) values.
  const fx = ref(`${appStore.convertForce(0)}`);
  const fz = ref(`${appStore.convertForce(0)}`);
  const my = ref('0');

  const mainLabel = computed(() => (loadTypeRef.value === 'force' ? 'F' : 'D'));
  const momentLabel = computed(() => (loadTypeRef.value === 'force' ? 'M' : 'R'));
  const mainUnits = computed(() =>
    loadTypeRef.value === 'force' ? appStore.units.Force : appStore.units.Displacement
  );
  const momentUnits = computed(() => (loadTypeRef.value === 'force' ? appStore.units.Moment : 'rad'));

  const toMain = (value: number) =>
    loadTypeRef.value === 'force' ? appStore.convertForce(value) : appStore.convertDisplacement(value);
  const fromMain = (value: string) =>
    loadTypeRef.value === 'force'
      ? appStore.convertInverseForce(parseFloat2(value))
      : appStore.convertInverseDisplacement(parseFloat2(value));
  // A prescribed rotation is stored and displayed in radians - no conversion.
  const toMoment = (value: number) => (loadTypeRef.value === 'force' ? appStore.convertMoment(value) : value);
  const fromMoment = (value: string) =>
    loadTypeRef.value === 'force' ? appStore.convertInverseMoment(parseFloat2(value)) : parseFloat2(value);

  const realFx = computed(() => fromMain(fx.value));
  // `vertical` is its own inverse, so the same call serves both ways
  const realFz = computed(() => appStore.vertical(fromMain(fz.value)));
  const realMy = computed(() => fromMoment(my.value));

  /** Fills the inputs (display units) from an existing load (model units). */
  const setFromLoad = (load: NodalLoad | PrescribedDisplacement) => {
    const values = 'prescribedValues' in load ? load.prescribedValues : load.values;

    fx.value = String(toMain(values[DofID.Dx]));
    fz.value = String(appStore.vertical(toMain(values[DofID.Dz])));
    my.value = String(toMoment(values[DofID.Ry]));
  };

  /** Writes the inputs back to an existing load, converting to model units. */
  const applyToLoad = (load: NodalLoad | PrescribedDisplacement) => {
    const values = 'prescribedValues' in load ? load.prescribedValues : load.values;

    values[DofID.Dx] = realFx.value;
    values[DofID.Dz] = realFz.value;
    values[DofID.Ry] = realMy.value;
  };

  /** Creates a new load of the currently selected type on the given load case. */
  const createLoad = (loadCase: LoadCase, nodeId: string | number) => {
    const values = { [DofID.Dx]: realFx.value, [DofID.Dz]: realFz.value, [DofID.Ry]: realMy.value };

    return loadTypeRef.value === 'force'
      ? loadCase.createNodalLoad(nodeId, values)
      : loadCase.createPrescribedDisplacement(nodeId, values);
  };

  return {
    appStore,
    projectStore,
    selectedNode,
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
  };
}
