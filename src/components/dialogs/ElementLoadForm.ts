import { ref, computed, type Ref } from 'vue';
import { useAppStore } from '@/store/app';
import { useProjectStore } from '@/store/project';
import { parseFloat2, rangeRule } from '@/utils';
import { newPointLoadPosition } from '@/utils/newEntityDefaults';
import { presetFamily } from '@/utils/presetFamily';
import {
  BeamElementLoad,
  BeamElementUniformEdgeLoad,
  BeamElementTrapezoidalEdgeLoad,
  BeamConcentratedLoad,
  BeamConcentratedDeformation,
  BeamTemperatureLoad,
  LoadCase,
} from 'ts-fem';

type AppStore = ReturnType<typeof useAppStore>;

/** Angles are always stored and displayed in radians, so no conversion takes place. */
const identity = (_store: AppStore, value: number) => value;

interface LoadTypeConfig {
  mainLabel: string;
  momentLabel: string;
  /**
   * What the three inputs are called, where the letter and the axis are not simply written together.
   * An imposed deformation names them for the movements they are, as every textbook does.
   */
  axisLabels?: readonly [string, string, string];
  getMainUnits: (store: AppStore) => string;
  getMomentUnits: (store: AppStore) => string;
  /** model value (SI) -> value shown in the input */
  toMain: (store: AppStore, value: number) => number;
  toMoment: (store: AppStore, value: number) => number;
  /** value typed in the input -> model value (SI) */
  fromMain: (store: AppStore, value: number) => number;
  fromMoment: (store: AppStore, value: number) => number;
}

export const LOAD_CONFIG: Record<string, LoadTypeConfig> = {
  concentrated: {
    mainLabel: 'F',
    momentLabel: 'M',
    getMainUnits: (store) => store.units.Force,
    getMomentUnits: (store) => store.units.Moment,
    toMain: (store, v) => store.convertForce(v),
    fromMain: (store, v) => store.convertInverseForce(v),
    toMoment: (store, v) => store.convertMoment(v),
    fromMoment: (store, v) => store.convertInverseMoment(v),
  },
  concentrated_deformation: {
    // the movement of one face of the section against the other, which is what a delta says
    mainLabel: 'Δ',
    momentLabel: 'Δφ',
    axisLabels: ['Δu', 'Δw', 'Δφ'],
    getMainUnits: (store) => store.units.Length,
    getMomentUnits: (store) => store.units.Angle,
    toMain: (store, v) => store.convertLength(v),
    fromMain: (store, v) => store.convertInverseLength(v),
    toMoment: identity,
    fromMoment: identity,
  },
  trapezoidal: {
    mainLabel: 'f',
    momentLabel: 'm',
    getMainUnits: (store) => store.units.ForceDistance,
    getMomentUnits: (store) => `${store.units.Moment}/${store.units.Length}`,
    // an intensity is a force per length, so both parts of the unit are converted
    toMain: (store, v) => store.convertForceDistance(v),
    fromMain: (store, v) => store.convertInverseForceDistance(v),
    toMoment: (store, v) => store.convertMoment(v),
    fromMoment: (store, v) => store.convertInverseMoment(v),
  },
  udl: {
    mainLabel: 'f',
    momentLabel: 'm',
    getMainUnits: (store) => store.units.ForceDistance,
    getMomentUnits: (store) => `${store.units.Moment}/${store.units.Length}`,
    // an intensity is a force per length, so both parts of the unit are converted
    toMain: (store, v) => store.convertForceDistance(v),
    fromMain: (store, v) => store.convertInverseForceDistance(v),
    toMoment: (store, v) => store.convertMoment(v),
    fromMoment: (store, v) => store.convertInverseMoment(v),
  },
  temperature: {
    mainLabel: 'T',
    momentLabel: 'ΔT',
    getMainUnits: (store) => store.units.Temperature,
    getMomentUnits: (store) => store.units.Temperature,
    toMain: (store, v) => store.convertTemperature(v),
    fromMain: (store, v) => store.convertInverseTemperature(v),
    toMoment: (store, v) => store.convertTemperature(v),
    fromMoment: (store, v) => store.convertInverseTemperature(v),
  },
};

export function useElementLoadForm(loadTypeRef: Ref<string>, targetElementIdRef: Ref<string>) {
  const appStore = useAppStore();
  const projectStore = useProjectStore();

  const config = computed(() => LOAD_CONFIG[loadTypeRef.value] ?? LOAD_CONFIG.udl);

  const mainLabel = computed(() => config.value.mainLabel);
  const momentLabel = computed(() => config.value.momentLabel);
  /*
   * The vertical axis is z down or y up, whichever the reader chose, and rotations turn about the
   * other one. The letters follow that; the local names of an imposed deformation do not, since
   * they are read along the element rather than along the drawing.
   */
  const labelX = computed(() => config.value.axisLabels?.[0] ?? `${mainLabel.value}x`);
  const labelZ = computed(() => config.value.axisLabels?.[1] ?? `${mainLabel.value}${appStore.axes.v}`);
  const labelMy = computed(() => config.value.axisLabels?.[2] ?? `${momentLabel.value}${appStore.axes.r}`);
  const mainUnits = computed(() => config.value.getMainUnits(appStore));
  const momentUnits = computed(() => config.value.getMomentUnits(appStore));

  // Every input holds a string in display units; the `reals` below are the model (SI) values.
  const fx = ref('0.0');
  const fz = ref('0.0');
  const my = ref('0.0');
  const trapStartFx = ref('0.0');
  const trapStartFz = ref('0.0');
  const trapEndFx = ref('0.0');
  const trapEndFz = ref('0.0');
  const tc = ref('0.0');
  const tbt = ref('0.0');
  const position = ref('0.0');
  /**
   * Where a trapezoidal load sits on its element, as distances from the first node.
   *
   * Empty means the whole element, which is what these loads were before they could be given a
   * position - so a load nobody touches here is saved, drawn and solved exactly as it was.
   */
  const trapFrom = ref('');
  const trapTo = ref('');
  const lcs = ref(true);

  const fromMain = (value: string) => config.value.fromMain(appStore, parseFloat2(value));
  const fromMoment = (value: string) => config.value.fromMoment(appStore, parseFloat2(value));
  const toMain = (value: number) => config.value.toMain(appStore, value);
  const toMoment = (value: number) => config.value.toMoment(appStore, value);

  const realFx = computed(() => fromMain(fx.value));
  // `vertical` is its own inverse, so the same call serves both ways
  const realFz = computed(() => appStore.vertical(fromMain(fz.value)));
  const realMy = computed(() => fromMoment(my.value));
  const realTrapStartFx = computed(() => fromMain(trapStartFx.value));
  const realTrapStartFz = computed(() => appStore.vertical(fromMain(trapStartFz.value)));
  const realTrapEndFx = computed(() => fromMain(trapEndFx.value));
  const realTrapEndFz = computed(() => appStore.vertical(fromMain(trapEndFz.value)));
  const realTc = computed(() => fromMain(tc.value));
  const realTbt = computed(() => fromMoment(tbt.value));
  const realDist = computed(() => appStore.convertInverseLength(parseFloat2(position.value)));

  /** What the model is given: a number where the box has one, and nothing where it is empty. */
  const spanValue = (typed: string) =>
    String(typed).trim() === '' ? undefined : appStore.convertInverseLength(parseFloat2(String(typed)));

  const realTrapFrom = computed(() => spanValue(trapFrom.value));
  const realTrapTo = computed(() => spanValue(trapTo.value));

  const target = computed(() => {
    if (!targetElementIdRef.value) return null;
    return projectStore.solver.domain.elements.get(targetElementIdRef.value) ?? null;
  });

  /** Element length in display units. */
  const elementLength = computed(() => {
    if (!target.value) return 0;
    return appStore.convertLength(target.value.computeGeo().l);
  });

  const minMax = (v: string | number) => {
    if (!target.value) return true;
    // the span boxes are allowed to say nothing, which means the whole element
    if (typeof v === 'string' && v.trim() === '') return true;
    return rangeRule(0, elementLength.value, appStore.units.Length)(v);
  };

  /** Places a concentrated load/deformation at a sensible default offset from the first node. */
  const resetPositionToDefault = () => {
    if (!target.value) return;
    const l = target.value.computeGeo().l;
    position.value = String(appStore.convertLength(newPointLoadPosition(l, presetFamily(appStore.units.Length))));
  };

  /**
   * What a newly chosen load type starts at, wherever zero is not the useful answer.
   *
   * An imposed deformation is almost always a unit rotation: that is the Muller-Breslau influence
   * line for a bending moment, which is what anyone reaching for this is drawing.
   */
  const applyTypeDefaults = () => {
    if (['concentrated', 'concentrated_deformation'].includes(loadTypeRef.value)) resetPositionToDefault();
    if (loadTypeRef.value === 'concentrated_deformation') my.value = '1';
  };

  /** Fills the inputs (display units) from an existing load (model units). */
  const setFromLoad = (load: BeamElementLoad) => {
    if (load instanceof BeamElementUniformEdgeLoad || load instanceof BeamConcentratedLoad) {
      fx.value = String(toMain(load.values[0]));
      fz.value = String(toMain(appStore.vertical(load.values[1])));
    }
    if (load instanceof BeamConcentratedDeformation) {
      fx.value = String(toMain(load.values[0]));
      fz.value = String(toMain(appStore.vertical(load.values[1])));
    }
    if (load instanceof BeamElementTrapezoidalEdgeLoad) {
      trapStartFx.value = String(toMain(load.startValues[0]));
      trapStartFz.value = String(toMain(appStore.vertical(load.startValues[1])));
      trapEndFx.value = String(toMain(load.endValues[0]));
      trapEndFz.value = String(toMain(appStore.vertical(load.endValues[1])));
    }
    if (load instanceof BeamConcentratedLoad || load instanceof BeamConcentratedDeformation) {
      my.value = String(toMoment(load.values[2]));
      position.value = String(appStore.convertLength(load.values[3]));
    }
    if (load instanceof BeamTemperatureLoad) {
      tc.value = String(toMain(load.values[0]));
      tbt.value = String(toMoment(load.values[1]));
    }
    if (load instanceof BeamElementTrapezoidalEdgeLoad) {
      trapFrom.value = load.from === undefined ? '' : String(appStore.convertLength(load.from));
      trapTo.value = load.to === undefined ? '' : String(appStore.convertLength(load.to));
    }
    if ('lcs' in load) {
      lcs.value = (load as { lcs: boolean }).lcs;
    }
  };

  /** Writes the inputs back to an existing load, converting to model units. */
  const applyToLoad = (load: BeamElementLoad) => {
    if (load instanceof BeamElementUniformEdgeLoad || load instanceof BeamConcentratedLoad) {
      load.values[0] = realFx.value;
      load.values[1] = realFz.value;
    }
    if (load instanceof BeamElementTrapezoidalEdgeLoad) {
      load.change(
        load.target,
        [realTrapStartFx.value, realTrapStartFz.value],
        [realTrapEndFx.value, realTrapEndFz.value],
        lcs.value,
        realTrapFrom.value,
        realTrapTo.value
      );
    }
    if (load instanceof BeamConcentratedLoad) {
      load.values[2] = realMy.value;
      load.values[3] = realDist.value;
    }
    if (load instanceof BeamConcentratedDeformation) {
      load.values[0] = realFx.value;
      load.values[1] = realFz.value;
      load.values[2] = realMy.value;
      load.values[3] = realDist.value;
    }
    if (load instanceof BeamTemperatureLoad) {
      load.values[0] = realTc.value;
      load.values[1] = realTbt.value;
    }
    if ('lcs' in load) {
      (load as { lcs: boolean }).lcs = lcs.value;
    }
  };

  /** Creates a new load of the currently selected type on the given load case. */
  const createLoad = (loadCase: LoadCase, elementId: string) => {
    switch (loadTypeRef.value) {
      case 'udl':
        return loadCase.createBeamElementUniformEdgeLoad(elementId, [realFx.value, realFz.value], lcs.value);
      case 'trapezoidal':
        return loadCase.createBeamElementTrapezoidalEdgeLoad(
          elementId,
          [realTrapStartFx.value, realTrapStartFz.value],
          [realTrapEndFx.value, realTrapEndFz.value],
          lcs.value,
          realTrapFrom.value,
          realTrapTo.value
        );
      case 'concentrated':
        return loadCase.createBeamConcentratedLoad(
          elementId,
          [realFx.value, realFz.value, realMy.value, realDist.value],
          lcs.value
        );
      case 'concentrated_deformation':
        // a section opens along and across its own element, so there is no system to choose
        return loadCase.createBeamConcentratedDeformation(
          elementId,
          [realFx.value, realFz.value, realMy.value, realDist.value],
          true
        );
      case 'temperature':
        return loadCase.createBeamTemperatureLoad(elementId, [realTc.value, realTbt.value, 0]);
      default:
        return null;
    }
  };

  const previewLoad = computed(() => {
    const domain = projectStore.solver.domain;
    const elementId = targetElementIdRef.value;
    if (!elementId) return null;

    if (loadTypeRef.value === 'udl') {
      return new BeamElementUniformEdgeLoad(elementId, domain, [realFx.value, realFz.value], lcs.value);
    }
    if (loadTypeRef.value === 'trapezoidal') {
      return new BeamElementTrapezoidalEdgeLoad(
        elementId,
        domain,
        [realTrapStartFx.value, realTrapStartFz.value],
        [realTrapEndFx.value, realTrapEndFz.value],
        lcs.value,
        realTrapFrom.value,
        realTrapTo.value
      );
    }
    if (loadTypeRef.value === 'concentrated') {
      return new BeamConcentratedLoad(
        elementId,
        domain,
        [realFx.value, realFz.value, realMy.value, realDist.value],
        lcs.value
      );
    }
    if (loadTypeRef.value === 'concentrated_deformation') {
      return new BeamConcentratedDeformation(
        elementId,
        domain,
        [realFx.value, realFz.value, realMy.value, realDist.value],
        true
      );
    }
    if (loadTypeRef.value === 'temperature') {
      return new BeamTemperatureLoad(elementId, domain, [realTc.value, realTbt.value, 0]);
    }
    return null;
  });

  return {
    appStore,
    projectStore,
    labelX,
    labelZ,
    labelMy,
    mainUnits,
    momentUnits,
    target,
    minMax,
    fx,
    fz,
    my,
    trapStartFx,
    trapStartFz,
    trapEndFx,
    trapEndFz,
    trapFrom,
    trapTo,
    tc,
    tbt,
    position,
    lcs,
    previewLoad,
    applyTypeDefaults,
    setFromLoad,
    applyToLoad,
    createLoad,
    reals: {
      realFx,
      realFz,
      realMy,
      realTrapStartFx,
      realTrapStartFz,
      realTrapEndFx,
      realTrapEndFz,
      realTrapFrom,
      realTrapTo,
      realDist,
      realTc,
      realTbt,
    },
  };
}
