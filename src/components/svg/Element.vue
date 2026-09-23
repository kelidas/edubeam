<script lang="ts" setup>
import { smoothPath } from '../../utils/smoothPath';
import {
  Node,
  LoadCase,
  Beam2D,
  BeamConcentratedLoad,
  BeamConcentratedDeformation,
  BeamElementTrapezoidalEdgeLoad,
} from 'ts-fem';
import { computed } from 'vue';
import { formatEngineeringNumber } from '@/utils/formatScientificNumber';

type ResultLabelMode = 'axis' | 'horizontal';
type ResultLabelAnchor = 'start' | 'end' | 'middle';

const props = withDefaults(
  defineProps<{
    element: Beam2D;
    scale: number;
    showDeformedShape: boolean;
    showNormalForce: boolean;
    showShearForce: boolean;
    showBendingMoment: boolean;
    showRotation: boolean;
    showLabel: boolean;
    showLabelBackground?: boolean;
    convertForce: (f: number) => number;
    convertMoment: (m: number) => number;
    convertLength?: (l: number) => number;
    loadCase: LoadCase;
    deformedShapeMultiplier: number;
    normalForceMultiplier: number;
    shearForceMultiplier: number;
    bendingMomentMultiplier: number;
    rotationMultiplier: number;
    resultLabelMode?: ResultLabelMode;
    padding?: number;
    fontSize?: number;
    numberFormat?: Intl.NumberFormat;
    /** Deflections span orders of magnitude, so they are formatted by significant digits. */
    deformationNumberFormat?: Intl.NumberFormat;
    /** Values on the deflected shape: what an influence line is read from, noise on a load case. */
    showDeflectionLabels?: boolean;
    /**
     * A spline reads better for a deflected shape, but rounds off the discontinuity a dislocation
     * makes, so the influence line workspace draws its curve straight through the sample points.
     */
    smoothDeformedShape?: boolean;
    showGeometry?: boolean;
    showResults?: boolean;
  }>(),
  {
    convertLength: (l: number) => l,
    padding: 10,
    fontSize: 13,
    showLabelBackground: true,
    resultLabelMode: 'axis',
    numberFormat: () => new Intl.NumberFormat(),
    deformationNumberFormat: () => new Intl.NumberFormat(undefined, { maximumSignificantDigits: 4 }),
    showDeflectionLabels: false,
    smoothDeformedShape: true,
    showGeometry: true,
    showResults: true,
  }
);

const elementCoords = computed(() => {
  const nodes = props.element.nodes.map((n) => props.element.domain.nodes.get(n)!.coords);
  return nodes.map((n: number[]) => `${n[0]},${n[2]}`).join(' ');
});

const elementFibers = computed(() => {
  const geo = props.element.computeGeo();
  const nz = geo.dx / geo.l;
  const nx = -geo.dz / geo.l;

  const nodes = props.element.nodes.map((n) => props.element.domain.nodes.get(n)!.coords);

  return nodes.map((n: number[]) => `${n[0] + (nx * 3) / props.scale},${n[2] + (nz * 3) / props.scale}`).join(' ');
});

const elementAngle = computed(() => {
  const geo = props.element.computeGeo();
  return Math.atan2(geo.dz, geo.dx) * (180 / Math.PI);
});

function resultLabelOffset(rawValue: number, nx: number, ny: number, factor = 0.45) {
  const offset = (props.fontSize * factor) / props.scale;
  const direction = Math.sign(rawValue) || 1;

  return [nx * direction * offset, ny * direction * offset];
}

function resultLabelOrientation(
  rawValue: number,
  nx: number,
  ny: number,
  position: number,
  length: number,
  labelDx: number,
  tangentX: number,
  labelX: number,
  beamMidX: number
) {
  if (props.resultLabelMode === 'horizontal') {
    const endpointTolerance = 1e-6;
    const horizontalAnchor: ResultLabelAnchor =
      Math.abs(labelX - beamMidX) < 1e-6 ? (tangentX >= 0 ? 'start' : 'end') : labelX < beamMidX ? 'end' : 'start';

    if (position <= endpointTolerance) {
      return { angle: 0, anchor: horizontalAnchor };
    }

    if (Math.abs(position - length) <= endpointTolerance) {
      return { angle: 0, anchor: horizontalAnchor };
    }

    return { angle: 0, anchor: 'middle' as ResultLabelAnchor };
  }

  const direction = Math.sign(rawValue) || 1;
  const outwardX = nx * direction;
  const outwardY = ny * direction;
  let angle = (Math.atan2(ny * direction, nx * direction) * 180) / Math.PI;

  if (Math.abs(Math.abs(angle) - 90) < 1e-6) {
    angle = -90;
  } else if (angle > 90) {
    angle -= 180;
  } else if (angle <= -90) {
    angle += 180;
  }

  const angleRad = (angle * Math.PI) / 180;
  const localXWorldX = Math.cos(angleRad);
  const localXWorldY = Math.sin(angleRad);
  const anchor = localXWorldX * outwardX + localXWorldY * outwardY < 0 ? 'end' : 'start';

  return { angle, anchor };
}

function labelAnchorOffset(anchor: ResultLabelAnchor) {
  if (anchor === 'middle') return 0;
  return anchor === 'end' ? -2 / props.scale : 2 / props.scale;
}

const elementLabel = computed(() => {
  const geo = props.element.computeGeo();
  const ny = geo.dx / geo.l;
  const nx = -geo.dz / geo.l;

  return `translate(${(-props.padding * nx) / props.scale}, ${(-props.padding * ny) / props.scale})`;
});

/** How far from its node a hinge circle sits, 9px unless the element is drawn shorter than that. */
const HINGE_OFFSET_PX = 9;

const hingeOffset = computed(() => {
  const geo = props.element.computeGeo();

  // In a small preview the element can be only a few pixels long, and an offset taken purely from
  // the scale would put the circle past the far node - drawing the hinge at the wrong end.
  return Math.min(HINGE_OFFSET_PX / props.scale, geo.l / 3);
});

const elementHinges = computed(() => {
  const n1 = props.element.domain.nodes.get(props.element.nodes[0]) as Node;
  const n2 = props.element.domain.nodes.get(props.element.nodes[1]) as Node;

  const geo = props.element.computeGeo();
  const offset = hingeOffset.value;

  const nx = (geo.dx / geo.l) * offset;
  const nz = (geo.dz / geo.l) * offset;

  const line1 = `${n1.coords[0] + nx}, ${n1.coords[2] + nz}`;
  const line2 = `${n2.coords[0] - nx}, ${n2.coords[2] - nz}`;

  return { 0: line1, 1: line2 };
});

/** The circle has to stay inside the element too, for the same reason. */
const hingeRadius = computed(() => Math.min(6 / props.scale, hingeOffset.value * (2 / 3)));

const results = computed(() => {
  if (!props.loadCase.solved || !props.showDeformedShape) return '';

  const hinges = props.element.hinges[0] && props.element.hinges[1];
  const eload = props.loadCase.elementLoadList.filter((l) => l.target === props.element.label);
  const truss = hinges && eload.length === 0;
  const geo = props.element.computeGeo();

  const nseg = truss ? 1 : 16;
  const scaleBy = props.deformedShapeMultiplier / props.scale;
  const n1 = props.element.domain.nodes.get(props.element.nodes[0]) as Node;
  let def = null;

  const dvalues: number[] = [];

  const straightPath = (points: [number, number][]): string => {
    if (points.length === 0) return '';
    return points.reduce((acc, [x, y], i) => {
      return i === 0 ? `M ${x},${y}` : `${acc} L ${x},${y}`;
    }, '');
  };

  // 1. Add concentrated deformation points
  const concentrated_deformations = props.loadCase.elementLoadList.filter(
    (l) => l.target === props.element.label && l instanceof BeamConcentratedDeformation
  ) as BeamConcentratedDeformation[];

  for (const c of concentrated_deformations) {
    const dVal = c.values[3];

    // Clamp the left point to strictly [0, geo.l]
    const dLeft = Math.min(Math.max(0, dVal - 1e-7), geo.l);

    // Clamp the right point to strictly [0, geo.l]
    const dRight = Math.min(Math.max(0, dVal + 1e-7), geo.l);

    dvalues.push(dLeft, dRight);
  }

  // 2. Add regular segment points
  for (let s = 0; s <= nseg; s++) {
    dvalues.push((geo.l * s) / nseg);
  }

  // 3. Sort points chronologically along the element axis
  dvalues.sort((a, b) => a - b);

  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;

  // 4. Compute combined global displacements and original geometry at each d
  const result = dvalues.map((d) => {
    const def = props.element.computeGlobalDeflAt(props.loadCase, d);

    // Calculate base x and z directly using physical distance 'd'
    const xc = n1.coords[0] + cos * d;
    const zc = n1.coords[2] + sin * d;

    return [xc + def.u * scaleBy, zc + def.w * scaleBy];
  });

  return props.smoothDeformedShape ? smoothPath(result) : straightPath(result);
});

/**
 * Deflection labels, at the concentrated loads and imposed deformations on this element - the
 * points a reader looks up, the way the force diagrams label their own values.
 */
const deflectionLabels = computed(() => {
  if (!props.loadCase.solved || !props.showDeformedShape || !props.showDeflectionLabels) return [];

  const geo = props.element.computeGeo();
  const n1 = props.element.domain.nodes.get(props.element.nodes[0]) as Node;
  const n2 = props.element.domain.nodes.get(props.element.nodes[1]) as Node;

  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;
  const nx = geo.dz / geo.l;
  const ny = -geo.dx / geo.l;
  const scaleBy = props.deformedShapeMultiplier / props.scale;

  // the nodes, then every concentrated load and imposed deformation between them
  const positions: number[] = [0, geo.l];

  for (const load of props.loadCase.elementLoadList) {
    if (load.target !== props.element.label) continue;
    if (!(load instanceof BeamConcentratedLoad) && !(load instanceof BeamConcentratedDeformation)) continue;

    // an imposed deformation makes the curve jump, so both sides carry a value
    positions.push(load.values[3] - 1e-7, load.values[3] + 1e-7);
  }

  const labels: [number, number, number, number, ResultLabelAnchor][] = [];
  const placed: { position: number; value: number }[] = [];

  for (const position of positions) {
    if (position < 0 || position > geo.l) continue;

    const local = props.element.computeLocalDeflAt(props.loadCase, position);
    const value = props.convertLength(local.w);
    if (Math.abs(value) < 1e-8) continue;

    // the two sides of a jump coincide unless the curve really jumps there
    if (placed.some((p) => Math.abs(p.position - position) < 1e-6 && Math.abs(p.value - value) < 1e-8)) continue;
    placed.push({ position, value });

    const global = props.element.computeGlobalDeflAt(props.loadCase, position);
    const x = n1.coords[0] + cos * position + global.u * scaleBy;
    const z = n1.coords[2] + sin * position + global.w * scaleBy;

    // Offset away from the beam, on the side the curve went: the deflected shape is drawn from the
    // displacement itself rather than off an axis, so the sign of the value says nothing about
    // which side of the element the label has to clear.
    const outward = global.u * nx + global.w * ny;
    const [dx, dy] = resultLabelOffset(outward, nx, ny);

    const orientation = resultLabelOrientation(
      outward,
      nx,
      ny,
      position,
      geo.l,
      x + dx - (n1.coords[0] + cos * position),
      cos,
      x + dx,
      (n1.coords[0] + n2.coords[0]) / 2
    );

    labels.push([x + dx, z + dy, value, orientation.angle, orientation.anchor]);
  }

  return labels;
});

/**
 * The rotation of the cross section along the element, drawn as a curve on the element's normal.
 *
 * It belongs with the deflected shape rather than with the internal forces: it is what the beam
 * does, not what it carries, so it is drawn plain, without a value written at every ordinate.
 *
 * ts-fem evaluates it, so the curve is the rotation itself rather than a difference taken from the
 * deflection it is the slope of.
 */
const rotationCurve = computed(() => {
  if (!props.loadCase.solved || !props.showRotation) return '';

  const element = props.element as unknown as { computeLocalRotationAt?: (lc: LoadCase, x: number) => number };

  // an older build of the library has no rotation to ask for
  if (typeof element.computeLocalRotationAt !== 'function') return '';

  const geo = props.element.computeGeo();
  const n1 = props.element.domain.nodes.get(props.element.nodes[0]) as Node;
  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;
  const nx = -geo.dz / geo.l;
  const ny = geo.dx / geo.l;
  const by = props.rotationMultiplier / props.scale;

  const SEGMENTS = 20;

  /*
   * An imposed rotation is a step in this curve, and a curve sampled at even intervals draws a
   * slope across it: the step is smeared over whichever interval it falls in and stands nowhere
   * near where it belongs. Read a hair either side of it, the two values sit next to each other and
   * the line between them stands up where the step is. It is the same hair the deflected shape is
   * read either side of, so the two agree about where the beam breaks.
   */
  const EITHER_SIDE = 1e-7;
  const steps = (
    props.loadCase.elementLoadList.filter(
      (l) => l.target === props.element.label && l instanceof BeamConcentratedDeformation
    ) as BeamConcentratedDeformation[]
  )
    .filter((load) => load.getLocalIntensities().dphi !== 0)
    .map((load) => load.values[3])
    .filter((at) => at > EITHER_SIDE && at < geo.l - EITHER_SIDE);

  const sections = [
    ...Array.from({ length: SEGMENTS + 1 }, (_, i) => (geo.l * i) / SEGMENTS).filter(
      (x) => !steps.some((step) => Math.abs(step - x) <= EITHER_SIDE)
    ),
    ...steps.flatMap((step) => [step - EITHER_SIDE, step + EITHER_SIDE]),
  ].sort((a, b) => a - b);

  const points: string[] = [`${n1.coords[0]},${n1.coords[2]}`];

  for (const along of sections) {
    const value = element.computeLocalRotationAt(props.loadCase, along);

    points.push(`${n1.coords[0] + cos * along + value * nx * by},${n1.coords[2] + sin * along + value * ny * by}`);
  }

  points.push(`${n1.coords[0] + cos * geo.l},${n1.coords[2] + sin * geo.l}`);

  return points.join(' ');
});

const forces = computed(() => {
  if (!props.loadCase.solved)
    return {
      normal: {
        text: [],
        values: '',
      },
      shear: {
        text: [],
        values: '',
      },
      moment: {
        text: [],
        values: '',
      },
    };

  let result = '';
  let resultV = '';
  let resultM = '';

  const nseg = 1;
  const nsegM = props.loadCase.elementLoadList.filter((l) => l.target === props.element.label).length === 0 ? 1 : 20;
  const scaleBy = props.normalForceMultiplier / props.scale;
  const scaleByV = props.shearForceMultiplier / props.scale;
  const scaleByM = props.bendingMomentMultiplier / props.scale;
  const n1 = props.element.domain.nodes.get(props.element.nodes[0]) as Node;
  const n2 = props.element.domain.nodes.get(props.element.nodes[1]) as Node;

  const geo = props.element.computeGeo();
  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;

  const nx = geo.dz / geo.l;
  const ny = -geo.dx / geo.l;
  const momentNx = -geo.dz / geo.l;
  const momentNy = geo.dx / geo.l;

  // Calculate V(x)=0
  //const dV = forcesV.V[nseg] - forcesV.V[0];
  const xmax = 0;

  // if (Math.abs(dV) > 1e-6) {
  //   xmax = -(forcesV.V[0] * geo.l) / dV;
  // }

  const labelsX = [0, geo.l];
  const labelsXM = xmax > 0 && xmax < geo.l ? [0, xmax, geo.l] : [0, geo.l];

  // values from 0 to element length
  const nvvalues = [];
  const mvalues = [];

  // Check if concentrated forces are present
  const concentrated = props.loadCase.elementLoadList.filter(
    (l) => l.target === props.element.label && l instanceof BeamConcentratedLoad
  ) as BeamConcentratedLoad[];

  for (const c of concentrated) {
    labelsX.push(c.values[3] - 1e-7);
    labelsX.push(c.values[3] + 1e-7);

    nvvalues.push(c.values[3] - 1e-7);
    nvvalues.push(c.values[3] + 1e-7);

    // if concentrated moment
    if (Math.abs(c.values[2]) > 1e-32) {
      labelsXM.push(c.values[3] - 1e-7);
      labelsXM.push(c.values[3] + 1e-7);
      mvalues.push(c.values[3] - 1e-7);
      mvalues.push(c.values[3] + 1e-7);
    } else {
      labelsXM.push(c.values[3]);
      mvalues.push(c.values[3]);
    }
  }

  // if element contains trapezoidal load, need to use segments
  const hasTrapezoidal = props.loadCase.elementLoadList.some(
    (l) => l.target === props.element.label && l instanceof BeamElementTrapezoidalEdgeLoad
  );

  // Trapezoidal has second degree Vz(x) and third order My(x)
  // TODO: must use odd number so we can guess Vz(x)=0 for max My estimation
  if (hasTrapezoidal) {
    for (let s = 0; s <= 11; s++) {
      nvvalues.push((geo.l * s) / 11);
    }
  }

  // TODO: why is nseg = 1 by default
  for (let s = 0; s <= nseg; s++) {
    nvvalues.push((geo.l * s) / nseg);
  }

  for (let s = 0; s <= nsegM; s++) {
    mvalues.push((geo.l * s) / nsegM);
  }

  labelsXM.sort((a, b) => a - b);
  mvalues.sort((a, b) => a - b);
  nvvalues.sort((a, b) => a - b);

  // Now go over V intervals to find potential max M
  for (let i = 0; i < nvvalues.length - 1; i++) {
    const v1 = nvvalues[i];
    const v2 = nvvalues[i + 1];
    const dv = v2 - v1;

    if (dv < 1e-6) continue;

    const vV1 = props.element.computeShearForceAt(props.loadCase, v1);
    const vV2 = props.element.computeShearForceAt(props.loadCase, v2);

    const v0 = (-vV1 * dv) / (vV2 - vV1) + v1;

    if (v0 > v1 && v0 < v2) {
      mvalues.push(v0);
      labelsXM.push(v0);
    }
  }

  labelsXM.sort((a, b) => a - b);
  mvalues.sort((a, b) => a - b);

  let nNzero = 0;
  let nVzero = 0;
  let nMzero = 0;

  for (let s = 0; s < nvvalues.length; s++) {
    const xc = n1.coords[0] + cos * nvvalues[s];
    const zc = n1.coords[2] + sin * nvvalues[s];

    const vNraw = props.element.computeNormalForceAt(props.loadCase, nvvalues[s]);
    const vVraw = props.element.computeShearForceAt(props.loadCase, nvvalues[s]);

    if (Math.abs(vNraw) < 1e-6) nNzero++;
    if (Math.abs(vVraw) < 1e-6) nVzero++;

    result += `${xc + vNraw * nx * scaleBy},${zc + vNraw * ny * scaleBy} `;
    resultV += `${xc + vVraw * nx * scaleByV},${zc + vVraw * ny * scaleByV} `;
  }

  for (let s = 0; s < mvalues.length; s++) {
    const xc = n1.coords[0] + cos * mvalues[s];
    const zc = n1.coords[2] + sin * mvalues[s];

    const nx = -geo.dz / geo.l;
    const ny = geo.dx / geo.l;

    const vMraw = props.element.computeBendingMomentAt(props.loadCase, mvalues[s]);
    if (Math.abs(vMraw) < 1e-6) nMzero++;

    resultM += `${xc + vMraw * nx * scaleByM},${zc + vMraw * ny * scaleByM} `;
  }

  if (nNzero === nvvalues.length) result = '';
  if (nVzero === nvvalues.length) resultV = '';
  if (nMzero === mvalues.length) resultM = '';

  const result2 = [];
  const result2V = [];
  const result2M = [];

  for (let s = 0; s < labelsX.length; s++) {
    const xc = n1.coords[0] + cos * labelsX[s];
    const zc = n1.coords[2] + sin * labelsX[s];

    const vNraw = props.element.computeNormalForceAt(props.loadCase, labelsX[s]);
    const vN = props.convertForce(vNraw);
    if (Math.abs(vN) > 1e-8) {
      const [dx, dy] = resultLabelOffset(vNraw, nx, ny);
      const labelX = xc + vNraw * nx * scaleBy + dx;
      const orientation = resultLabelOrientation(
        vNraw,
        nx,
        ny,
        labelsX[s],
        geo.l,
        vNraw * nx * scaleBy + dx,
        cos,
        labelX,
        (n1.coords[0] + n2.coords[0]) / 2
      );
      result2.push([labelX, zc + vNraw * ny * scaleBy + dy, vN, orientation.angle, orientation.anchor]);
    }

    const vVraw = props.element.computeShearForceAt(props.loadCase, labelsX[s]);
    const vV = props.convertForce(vVraw);
    if (Math.abs(vV) > 1e-8) {
      const [dx, dy] = resultLabelOffset(vVraw, nx, ny);
      const labelX = xc + vVraw * nx * scaleByV + dx;
      const orientation = resultLabelOrientation(
        vVraw,
        nx,
        ny,
        labelsX[s],
        geo.l,
        vVraw * nx * scaleByV + dx,
        cos,
        labelX,
        (n1.coords[0] + n2.coords[0]) / 2
      );
      result2V.push([labelX, zc + vVraw * ny * scaleByV + dy, vV, orientation.angle, orientation.anchor]);
    }
  }

  for (let s = 0; s < labelsXM.length; s++) {
    const xc = n1.coords[0] + cos * labelsXM[s];
    const zc = n1.coords[2] + sin * labelsXM[s];

    const vMraw = props.element.computeBendingMomentAt(props.loadCase, labelsXM[s]);
    const vM = props.convertMoment(vMraw);
    if (Math.abs(vMraw) > 1e-8) {
      const isExtrema = labelsXM.length > 2 && s !== 0 && s !== labelsXM.length - 1;
      const chartX = xc + vMraw * momentNx * scaleByM;
      const chartY = zc + vMraw * momentNy * scaleByM;
      const [dx, dy] = resultLabelOffset(vMraw, momentNx, momentNy, isExtrema ? 0.7 : 0.45);
      const orientation = resultLabelOrientation(
        vMraw,
        momentNx,
        momentNy,
        labelsXM[s],
        geo.l,
        chartX + dx - xc,
        cos,
        chartX + dx,
        (n1.coords[0] + n2.coords[0]) / 2
      );

      result2M.push([
        xc,
        zc,
        chartX,
        chartY,
        chartX + dx,
        chartY + dy,
        vM,
        isExtrema,
        orientation.angle,
        orientation.anchor,
      ]);
    }
  }

  const ret = {
    normal: { values: `${n1.coords[0]},${n1.coords[2]} ${result}${n2.coords[0]},${n2.coords[2]}`, text: result2 },
    shear: { values: `${n1.coords[0]},${n1.coords[2]} ${resultV}${n2.coords[0]},${n2.coords[2]}`, text: result2V },
    moment: { values: `${n1.coords[0]},${n1.coords[2]} ${resultM}${n2.coords[0]},${n2.coords[2]}`, text: result2M },
  };

  if (!props.showBendingMoment) {
    ret.moment.text = [];
    ret.moment.values = '';
  }

  if (!props.showShearForce) {
    ret.shear.text = [];
    ret.shear.values = '';
  }

  if (!props.showNormalForce) {
    ret.normal.text = [];
    ret.normal.values = '';
  }

  return ret;
});

const emit = defineEmits(['elementmousemove', 'elementresultsmousemove', 'elementpointerup']);
</script>

<template>
  <g class="element element-1d">
    <path
      v-if="showResults && loadCase.solved && showDeformedShape"
      data-fit-ignore="results"
      :d="results"
      vector-effect="non-scaling-stroke"
      class="deformedShape pointer-events-none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <g
      v-for="(dl, dli) in showResults ? deflectionLabels : []"
      :key="`deflection-${dli}`"
      data-fit-ignore="results"
      class="pointer-events-none"
      :transform="`translate(${dl[0]} ${dl[1]}) rotate(${dl[3]})`"
    >
      <!--
        No plate behind these. The one the other labels carry is a white flood over the whole box of
        the text, which is invisible where they sit - out beyond their diagram, against the page -
        but an influence line is drawn filled, and its own values sit on top of that fill, where the
        flood reads as a white card laid over the shape.
      -->
      <text
        :font-size="fontSize / scale"
        class="deflection-label"
        font-weight="normal"
        :x="labelAnchorOffset(dl[4])"
        y="0"
        :text-anchor="dl[4]"
        dominant-baseline="central"
      >
        {{ formatEngineeringNumber(dl[2], deformationNumberFormat) }}
      </text>
    </g>

    <g
      v-if="showResults && loadCase.solved && showNormalForce"
      class="normal"
      data-fit-ignore="results"
      @mousemove="emit('elementresultsmousemove', $event, element)"
      @pointerup="emit('elementpointerup', $event)"
    >
      <polyline
        :points="forces.normal.values"
        vector-effect="non-scaling-stroke"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <g
        v-for="(mv, mli) in forces.normal.text"
        :key="mli"
        :transform="`translate(${mv[0]} ${mv[1]}) rotate(${mv[3]})`"
      >
        <text
          v-if="showLabelBackground"
          :font-size="fontSize / scale"
          class="moment-label filter-text-label"
          font-weight="normal"
          :x="labelAnchorOffset(mv[4])"
          y="0"
          :text-anchor="mv[4]"
          dominant-baseline="central"
        >
          {{ numberFormat.format(Math.abs(mv[2]) < 1e-6 ? 0 : mv[2]) }}
        </text>
        <text
          :font-size="fontSize / scale"
          class="moment-label"
          font-weight="normal"
          :x="labelAnchorOffset(mv[4])"
          y="0"
          :text-anchor="mv[4]"
          dominant-baseline="central"
        >
          {{ numberFormat.format(Math.abs(mv[2]) < 1e-6 ? 0 : mv[2]) }}
        </text>
      </g>
    </g>
    <g
      v-if="showResults && loadCase.solved && showShearForce"
      class="shear"
      data-fit-ignore="results"
      @mousemove="emit('elementresultsmousemove', $event, element)"
      @pointerup="emit('elementpointerup', $event)"
    >
      <polyline
        :points="forces.shear.values"
        vector-effect="non-scaling-stroke"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <g v-for="(mv, mli) in forces.shear.text" :key="mli" :transform="`translate(${mv[0]} ${mv[1]}) rotate(${mv[3]})`">
        <text
          v-if="showLabelBackground"
          :font-size="fontSize / scale"
          class="moment-label filter-text-label"
          font-weight="normal"
          :x="labelAnchorOffset(mv[4])"
          y="0"
          :text-anchor="mv[4]"
          dominant-baseline="central"
        >
          {{ numberFormat.format(Math.abs(mv[2]) < 1e-6 ? 0 : mv[2]) }}
        </text>
        <text
          :font-size="fontSize / scale"
          class="moment-label"
          font-weight="normal"
          :x="labelAnchorOffset(mv[4])"
          y="0"
          :text-anchor="mv[4]"
          dominant-baseline="central"
        >
          {{ numberFormat.format(Math.abs(mv[2]) < 1e-6 ? 0 : mv[2]) }}
        </text>
      </g>
    </g>

    <g v-if="showResults && loadCase.solved && showRotation" class="rotation" data-fit-ignore="results">
      <polyline
        :points="rotationCurve"
        vector-effect="non-scaling-stroke"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>

    <g
      v-if="showResults && loadCase.solved && showBendingMoment"
      class="moment"
      data-fit-ignore="results"
      @mousemove="emit('elementresultsmousemove', $event, element)"
      @pointerup="emit('elementpointerup', $event)"
    >
      <polyline
        :points="forces.moment.values"
        vector-effect="non-scaling-stroke"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <g v-for="(mv, mli) in forces.moment.text" :key="mli">
        <polyline
          :points="`${mv[0]},${mv[1]} ${mv[2]},${mv[3]}`"
          vector-effect="non-scaling-stroke"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <text
          v-if="showLabelBackground"
          :font-size="fontSize / scale"
          class="moment-label filter-text-label"
          font-weight="normal"
          :x="labelAnchorOffset(mv[9])"
          y="0"
          :text-anchor="mv[9]"
          dominant-baseline="central"
          :transform="`translate(${mv[4]} ${mv[5]}) rotate(${mv[8]})`"
        >
          {{ numberFormat.format(Math.abs(mv[6]) < 1e-6 ? 0 : mv[6]) }}
        </text>
        <text
          :font-size="fontSize / scale"
          class="moment-label"
          font-weight="normal"
          :x="labelAnchorOffset(mv[9])"
          y="0"
          :text-anchor="mv[9]"
          dominant-baseline="central"
          :transform="`translate(${mv[4]} ${mv[5]}) rotate(${mv[8]})`"
        >
          {{ numberFormat.format(Math.abs(mv[6]) < 1e-6 ? 0 : mv[6]) }}
        </text>
      </g>
    </g>

    <template v-if="showGeometry">
      <polyline :points="elementCoords" vector-effect="non-scaling-stroke" class="drawable" stroke-linecap="round" />

      <polyline :points="elementFibers" class="fibers" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" />

      <circle
        v-if="element.hinges[0]"
        :transform="`translate(${elementHinges[0]})`"
        :r="hingeRadius"
        fill="white"
        stroke="black"
        vector-effect="non-scaling-stroke"
        stroke-width="2"
      />

      <circle
        v-if="element.hinges[1]"
        :transform="`translate(${elementHinges[1]})`"
        :r="hingeRadius"
        fill="white"
        stroke="black"
        vector-effect="non-scaling-stroke"
        stroke-width="2"
      />

      <g>
        <text
          v-if="showLabel"
          :x="
            (element.domain.nodes.get(element.nodes[0])!.coords[0] +
              element.domain.nodes.get(element.nodes[1])!.coords[0]) /
            2
          "
          :y="
            (element.domain.nodes.get(element.nodes[0])!.coords[2] +
              element.domain.nodes.get(element.nodes[1])!.coords[2]) /
            2
          "
          :font-size="fontSize / scale"
          font-weight="normal"
          text-anchor="middle"
          dominant-baseline="central"
          :transform="`${elementLabel} rotate(${elementAngle} ${
            (element.domain.nodes.get(element.nodes[0])!.coords[0] +
              element.domain.nodes.get(element.nodes[1])!.coords[0]) /
            2
          } ${
            (element.domain.nodes.get(element.nodes[0])!.coords[2] +
              element.domain.nodes.get(element.nodes[1])!.coords[2]) /
            2
          })`"
        >
          {{ element.label }}
        </text>
      </g>

      <polyline
        :points="elementCoords"
        vector-effect="non-scaling-stroke"
        class="handle"
        :data-element-id="element.label"
        @mousemove="emit('elementmousemove', $event, element)"
        @pointerup="emit('elementpointerup', $event)"
      />
    </template>
  </g>
</template>
