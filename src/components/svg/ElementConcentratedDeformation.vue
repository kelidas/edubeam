<script lang="ts" setup>
import { BeamConcentratedDeformation } from 'ts-fem';
import { computed } from 'vue';
import { vertical } from '@/utils/axisConvention';

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
const MOMENT_SIDE_OFFSET = 8;
/** How big the circle is on the screen, whatever the drawing is zoomed to. */
const ROTATION_RADIUS = 18;
const SHAFT = 40;

/** The hinge at a released rotation, the size the hinges on an element are drawn. */
const HINGE_RADIUS = 6;
/** A roller of the sliding plate: the size of the hinge, so the releases read as one family. */
const ROLLER_RADIUS = HINGE_RADIUS;
const ROLLER_SPACING = 14;
/** Half the distance between the plates: the rollers run between them without touching. */
const PLATE_GAP = ROLLER_RADIUS + 1.5;
/** Half the length of a plate: long enough to hold the three rollers with a little to spare. */
const PLATE_HALF_LENGTH = ROLLER_SPACING + ROLLER_RADIUS + 3;
/** The room left between a plate and the arrows, so neither is read as part of the other. */
const PLATE_CLEARANCE = 8;

/** The local axes of the element in the coordinates the drawing is in. */
const axes = computed(() => {
  const geo = target.value.computeGeo();
  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;

  return { along: [cos, sin] as const, across: [-sin, cos] as const };
});

/** The imposed movement resolved onto the element, whichever frame it was typed in. */
const slip = computed(() => {
  const [vx, vz] = [props.eload.values[0], props.eload.values[1]];

  if (props.eload.lcs) return { axial: vx, transverse: vz };

  const { along, across } = axes.value;

  return { axial: along[0] * vx + along[1] * vz, transverse: across[0] * vx + across[1] * vz };
});

/**
 * A sliding plate: two plates with three rollers between them, drawn about the section.
 *
 * The plates run the way the two faces travel and the rollers roll along them, so a slip along the
 * beam lies flat on it and a slip across it stands upright - which is the way these are drawn on
 * paper, and the way a reader tells one release from the other at a glance.
 *
 * What lies between the plates is painted out first, so the beam runs into the symbol and stops
 * there instead of running through the rollers. A release does part the beam, and drawing it parted
 * is both what a reader expects and the only way the small circles stay readable.
 */
const slidingPlate = (travel: readonly [number, number], standoff = 0) => {
  const normal = [-travel[1], travel[0]] as const;
  const half = PLATE_HALF_LENGTH / props.scale;
  const gap = PLATE_GAP / props.scale;
  const spacing = ROLLER_SPACING / props.scale;
  const from = standoff / props.scale;
  const at = (u: number, v: number) => ({
    x: position.value.x + travel[0] * u + normal[0] * (v + from),
    z: position.value.z + travel[1] * u + normal[1] * (v + from),
  });
  const corners = [at(-half, -gap), at(half, -gap), at(half, gap), at(-half, gap)];

  return {
    backing: corners.map((c) => `${c.x},${c.z}`).join(' '),
    plates: [gap, -gap].map((side) => {
      const from = at(-half, side);
      const to = at(half, side);

      return `${from.x},${from.z} ${to.x},${to.z}`;
    }),
    rollers: [-spacing, 0, spacing].map((u) => ({ ...at(u, 0), r: ROLLER_RADIUS / props.scale })),
  };
};

/** The releases at the section: what kind of movement the arrows beside them stand for. */
const releases = computed(() => {
  const plates = [];

  if (slip.value.axial !== 0) plates.push(slidingPlate(axes.value.along));
  if (slip.value.transverse !== 0) plates.push(slidingPlate(axes.value.across));

  return plates;
});

/**
 * How far apart the two arrows sit.
 *
 * Wide enough to leave the plate between them whole, since an arrow drawn from inside one would read
 * as part of it.
 */
const arrowOffset = computed(() =>
  releases.value.length > 0 ? Math.max(SIDE_OFFSET, PLATE_GAP + PLATE_CLEARANCE) : SIDE_OFFSET
);

/** Which way the pair turns as a whole; the far face is then the mirror of the near one. */
const isNegativeRotation = () => props.eload.values[2] < 0;

const sides = computed(() => {
  const geo = target.value.computeGeo();
  const cos = geo.dx / geo.l;
  const sin = geo.dz / geo.l;
  const step = arrowOffset.value / props.scale;
  const arcStep = MOMENT_SIDE_OFFSET / props.scale;
  const shaft = SHAFT / props.scale;

  /*
   * Which of the two ways across the arrows the near face takes.
   *
   * Where stepping across the arrows is also stepping along the beam - a slip across it - the near
   * face belongs on the near side, whichever way the value points. Where it is not, which is a slip
   * along the beam, either side will do and this settles on one.
   */
  const asideOf = (turn: number) => {
    const away = (angle.value - 90 + turn) * (Math.PI / 180);

    return { x: Math.sin(away), z: -Math.cos(away) };
  };
  const near = asideOf(0);
  const flip = near.x * cos + near.z * sin > 1e-9 ? -1 : 1;

  return [
    // the face on the start side keeps the sense of the value, the other one opposes it
    { turn: 0, opposed: false },
    { turn: 180, opposed: true },
  ].map(({ turn, opposed }) => {
    const away = (angle.value - 90 + turn) * (Math.PI / 180);
    /*
     * Each arrow steps aside across its own direction, not along the beam: two arrows offset the way
     * they point would be one line with a head at each end, which says nothing about which face is
     * which. Side by side, they read as the two faces passing each other - which is the movement.
     */
    const aside = asideOf(turn);
    const at = {
      x: position.value.x + aside.x * step * flip,
      z: position.value.z + aside.z * step * flip,
    };

    /*
     * The head goes at the far end of the shaft, not at the beam. An arrow drawn the other way says
     * something is pushing on this point; these two say the two faces of the cut move apart, which
     * is what the symbol is for.
     */
    return {
      ...at,
      turn,
      opposed,
      tipX: at.x + shaft * Math.cos(away),
      tipZ: at.z + shaft * Math.sin(away),
      // the bulge of each half is on its own side, so the two together close a circle
      arcX: position.value.x + (opposed ? cos : -cos) * arcStep,
      arcZ: position.value.z + (opposed ? sin : -sin) * arcStep,
    };
  });
});

/**
 * The two halves of the circle, each a semicircle standing on the section.
 *
 * Both run the same way round, so both heads end at the same end of the circle - up for a positive
 * rotation, down for a negative one. Each bulges away from the other, so the two of them close a
 * circle with the section in the gap.
 *
 * Drawn here rather than hung off a marker: a marker is anchored by a reference point that is
 * fitted along with its own view box, and getting the centre of a circle to land on the section
 * that way is guesswork. The radius is in pixels of the screen, so the symbol keeps its size at any
 * zoom, as every other mark on the drawing does.
 */
const rotationArcs = computed(() => {
  const radius = ROTATION_RADIUS / props.scale;
  const upward = !isNegativeRotation();

  /*
   * The two ends of each half circle lie across the element, not straight up and down the page: the
   * pair straddles the section, and the section runs across the beam whichever way the beam runs.
   * Rotating both ends and leaving the radius and the flag alone turns the whole arc with it.
   */
  const { across } = axes.value;

  return sides.value.map((side) => {
    // from one end of the circle to the other, or the other way about
    const [from, to] = upward ? [radius, -radius] : [-radius, radius];
    // and round the side it stands on, which for a given direction of travel is one flag or the other
    const sweep = upward !== side.opposed ? 1 : 0;
    const at = (along: number) => `${side.arcX + across[0] * along} ${side.arcZ + across[1] * along}`;

    return `M ${at(from)} A ${radius} ${radius} 0 0 ${sweep} ${at(to)}`;
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
        :transform="`translate(${side.tipX} ${side.tipZ}) rotate(${angle + side.turn + 180})`"
      />

      <!-- An imposed deformation is not a force, so its arrow carries a dashed shaft -->
      <polyline
        :points="`${side.x},${side.z} ${side.x + 40 / scale},${side.z}`"
        :transform="`rotate(${angle - 90 + side.turn} ${side.x} ${side.z})`"
        stroke-dasharray="6 4"
        class="decoration shaft"
        vector-effect="non-scaling-stroke"
      />

      <polyline
        :points="`${side.x},${side.z} ${side.x + 40 / scale},${side.z}`"
        :transform="`rotate(${angle - 90 + side.turn} ${side.x} ${side.z})`"
        class="handle"
      />
    </template>

    <template v-for="(side, i) in eload.values[2] !== 0 ? sides : []" :key="`r-${i}`">
      <path class="decoration moment dislocation-rotation" :d="rotationArcs[i]" />

      <!-- the circle itself is the thing to aim at, so the grab area follows it rather than its centre -->
      <path class="handle moment" :d="rotationArcs[i]" />
    </template>

    <!--
      The release at the section, over the arrows that say how far it opens: a hinge for a turn, a
      sliding plate for a slip, both in the colour the arrows are drawn in.
    -->
    <template v-for="(plate, i) in releases" :key="`p-${i}`">
      <polygon :points="plate.backing" class="release backing" />

      <polyline
        v-for="(points, j) in plate.plates"
        :key="`pl-${i}-${j}`"
        :points="points"
        class="release plate"
        vector-effect="non-scaling-stroke"
      />

      <circle
        v-for="(roller, j) in plate.rollers"
        :key="`ro-${i}-${j}`"
        :cx="roller.x"
        :cy="roller.z"
        :r="roller.r"
        class="release roller"
        vector-effect="non-scaling-stroke"
      />
    </template>

    <circle
      v-if="eload.values[2] !== 0"
      :cx="position.x"
      :cy="position.z"
      :r="HINGE_RADIUS / scale"
      class="release hinge"
      vector-effect="non-scaling-stroke"
    />

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
        {{ numberFormat.format(vertical(convertDisplacement(eload.values[1]))) }})
      </template>
    </text>
  </g>
</template>
