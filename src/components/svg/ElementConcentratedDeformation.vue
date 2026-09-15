<script lang="ts" setup>
import { BeamConcentratedDeformation } from 'ts-fem';
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    eload: BeamConcentratedDeformation;
    scale: number;
    /** displacement (length) converter, values[0] and values[1] */
    convertDisplacement: (d: number) => number;
    /** rotation (angle) converter, values[2] */
    convertRotation?: (r: number) => number;
    fontSize?: number;
    numberFormat: Intl.NumberFormat;
  }>(),
  { fontSize: 13, convertRotation: (r: number) => r }
);

const target = computed(() => {
  return props.eload.domain.elements.get(props.eload.target)!;
});

const position = computed(() => {
  const n1 = props.eload.domain.nodes.get(target.value.nodes[0]);

  const geo = target.value.computeGeo();

  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;

  return {
    x: n1.coords[0] + cos * props.eload.values[3],
    z: n1.coords[2] + sin * props.eload.values[3],
  };
});

const angle = computed(() => {
  const geo = target.value.computeGeo();
  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;

  if (props.eload.lcs)
    return -((Math.atan2(props.eload.values[0], props.eload.values[1]) + Math.atan2(cos, sin)) * 180) / Math.PI + 90;
  else return -(Math.atan2(props.eload.values[0], props.eload.values[1]) * 180) / Math.PI;
});

const labelPosition = computed(() => {
  const size = Math.sqrt(props.eload.values[0] * props.eload.values[0] + props.eload.values[1] * props.eload.values[1]);
  const fx = props.eload.values[0] / size;
  const fz = props.eload.values[1] / size;

  if (!props.eload.lcs)
    return `translate(${position.value.x - (45 / props.scale) * fx} ${position.value.z - (45 / props.scale) * fz})`;

  let px = 0;
  let pz = 0;

  const geo = target.value.computeGeo();
  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;

  // local to global
  const fxl = cos * fx - sin * fz;
  const fzl = sin * fx + cos * fz;

  px += position.value.x - (fxl * 45) / props.scale;
  pz += position.value.z - (fzl * 45) / props.scale;

  return `translate(${px} ${pz})`;
});

/**
 * The two halves of the cut, a little either side of it.
 *
 * An imposed deformation is a relative movement of the two faces of a section, not a force applied
 * to one point, and it is drawn as such: the same symbol twice, once for each face, pointing
 * against each other. A reader who sees one arrow reads a load; a reader who sees two opposed ones
 * reads a release, which is what an influence line is drawn from.
 *
 * The offset is small on purpose. Far enough apart to be seen as two, near enough to be read as
 * belonging to one section.
 */
const SIDE_OFFSET = 7;
/** The two halves of the circle stand just clear of each other, leaving the section between them. */
const MOMENT_SIDE_OFFSET = 4;
/** How big the circle is on the screen, whatever the drawing is zoomed to. */
const ROTATION_RADIUS = 18;
const SHAFT = 40;

/** Which way the pair turns as a whole; the far face is then the mirror of the near one. */
const isNegativeRotation = () => props.eload.values[2] < 0;

const sides = computed(() => {
  const geo = target.value.computeGeo();
  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;
  const step = SIDE_OFFSET / props.scale;
  const arcStep = MOMENT_SIDE_OFFSET / props.scale;
  const shaft = SHAFT / props.scale;

  // both faces are drawn the same way round, so a positive value sends both arrows the same way
  const away = (angle.value - 90) * (Math.PI / 180);

  return [{ opposed: false }, { opposed: true }].map(({ opposed }) => {
    const at = {
      x: position.value.x + (opposed ? cos : -cos) * step,
      z: position.value.z + (opposed ? sin : -sin) * step,
    };

    /*
     * The head goes at the far end of the shaft, not at the beam. An arrow drawn the other way says
     * something is pushing on this point; these say which way the faces of the cut go.
     */
    return {
      ...at,
      opposed,
      tipX: at.x + shaft * Math.cos(away),
      tipZ: at.z + shaft * Math.sin(away),
      // the bulge of each half is on its own side, so the two together close a circle
      arcX: position.value.x + (opposed ? -cos : cos) * arcStep,
      arcZ: position.value.z + (opposed ? -sin : sin) * arcStep,
      /*
       * Turned through half a turn rather than mirrored. A mirror puts both heads at the same end,
       * where they sit on top of one another; turning one over puts them at opposite ends of the
       * circle, which is what two faces turning against each other look like.
       */
      turned: opposed !== isNegativeRotation(),
    };
  });
});

/**
 * The two halves of the circle, each a semicircle standing on the section.
 *
 * Drawn here rather than hung off a marker: a marker is anchored by a reference point that is
 * fitted along with its own view box, and getting the centre of a circle to land on the section
 * that way is guesswork. The radius is in pixels of the screen, so the symbol keeps its size at any
 * zoom, as every other mark on the drawing does.
 */
const rotationArcs = computed(() => {
  const radius = ROTATION_RADIUS / props.scale;

  return sides.value.map((side) => {
    const [from, to] = side.turned ? [radius, -radius] : [-radius, radius];

    return `M ${side.arcX} ${side.arcZ + from} A ${radius} ${radius} 0 0 1 ${side.arcX} ${side.arcZ + to}`;
  });
});

const momentLabelPosition = computed(() => {
  return `translate(${position.value.x + (props.fontSize + 8) / props.scale}
          ${position.value.z - (props.fontSize / 2 + 2) / props.scale})`;
});
</script>

<template>
  <g class="nodal-load">
    <!--
      One symbol for each face of the cut, pointing against each other: the movement is relative, so
      a single arrow would read as a load applied at the point rather than as a release.
    -->
    <template v-for="(side, i) in eload.values[0] !== 0 || eload.values[1] !== 0 ? sides : []" :key="`d-${i}`">
      <polyline
        points="0,0 0,0"
        vector-effect="non-scaling-stroke"
        class="decoration force"
        :transform="`translate(${side.tipX} ${side.tipZ}) rotate(${angle + 180})`"
      />

      <!-- An imposed deformation is not a force, so its arrow carries a dashed shaft -->
      <polyline
        :points="`${side.x},${side.z} ${side.x + 40 / scale},${side.z}`"
        :transform="`rotate(${angle - 90} ${side.x} ${side.z})`"
        stroke-dasharray="6 4"
        class="decoration shaft"
        vector-effect="non-scaling-stroke"
      />

      <polyline
        :points="`${side.x},${side.z} ${side.x + 40 / scale},${side.z}`"
        :transform="`rotate(${angle - 90} ${side.x} ${side.z})`"
        class="handle"
      />
    </template>

    <template v-for="(side, i) in eload.values[2] !== 0 ? sides : []" :key="`r-${i}`">
      <path class="decoration moment dislocation-rotation" :d="rotationArcs[i]" />

      <polyline :points="`${side.arcX},${side.arcZ} ${side.arcX + 1e-6},${side.arcZ}`" class="handle moment" />
    </template>

    <text
      v-if="eload.values[2] !== 0"
      :font-size="fontSize / scale"
      font-weight="normal"
      text-anchor="start"
      dominant-baseline="central"
      :transform="momentLabelPosition"
    >
      {{ numberFormat.format(Math.abs(convertRotation(eload.values[2]))) }}
    </text>

    <text
      v-if="eload.values[0] !== 0 || eload.values[1] !== 0"
      :font-size="fontSize / scale"
      font-weight="normal"
      dominant-baseline="central"
      :text-anchor="eload.values[0] > 0 ? 'end' : 'start'"
      :transform="labelPosition"
    >
      {{
        numberFormat.format(
          convertDisplacement(Math.sqrt(eload.values[0] * eload.values[0] + eload.values[1] * eload.values[1]))
        )
      }}
      <template v-if="eload.values[0] !== 0 && eload.values[1] !== 0">
        ({{ numberFormat.format(convertDisplacement(eload.values[0])) }};
        {{ numberFormat.format(convertDisplacement(eload.values[1])) }})
      </template>
    </text>
  </g>
</template>
