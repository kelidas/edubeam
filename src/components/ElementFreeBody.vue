<script setup lang="ts">
import { computed } from 'vue';
import type { Beam2D, LoadCase } from 'ts-fem';
import { useViewerStore } from '../store/viewer';
import {
  elementAxes,
  elementEndForces,
  elementHinges,
  elementLoadShapes,
  type FreeBodySystem,
} from '../utils/freeBody';
import {
  forceArrow,
  forceLength,
  freeDirection,
  labelBeyond,
  momentArc,
  textCorners,
  unit,
  viewBoxAround,
  type Label,
  type Vec,
} from '../utils/freeBodyDrawing';

/**
 * An element cut out of the structure: drawn as the model has it, with its loads, and with what its
 * two nodes do to it - the end forces tab's total vector - as arrows at its ends.
 */
const props = defineProps<{
  element: Beam2D;
  loadCase: LoadCase;
  system: FreeBodySystem;
  /** How a number is written: the widget's own way, so the drawing reads like its tables. */
  show: (value: number) => string;
}>();

const viewerStore = useViewerStore();

/** Half the drawn element, in drawing units: drawn the same size whatever its length. */
const HALF = 130;
const ARC = 24;
/** The tallest a distributed load is drawn, and the shortest of its arrows that still shows. */
const BAND = 46;
const BAND_MIN = 10;
const FONT = 15;

const axes = computed(() => elementAxes(props.element));
const along = computed<Vec>(() => ({ x: axes.value.along.x, y: axes.value.along.z }));
const normal = computed<Vec>(() => ({ x: axes.value.normal.x, y: axes.value.normal.z }));
const length = computed(() => props.element.computeGeo().l);

const ends = computed<[Vec, Vec]>(() => [
  { x: -HALF * along.value.x, y: -HALF * along.value.y },
  { x: HALF * along.value.x, y: HALF * along.value.y },
]);

/** A point on the drawn element, given in metres from its first node. */
const pointAt = (x: number): Vec => {
  const t = length.value > 0 ? x / length.value : 0;
  const [a, b] = ends.value;

  return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
};

/** Away from the element at each of its ends. */
const outward = (end: number): Vec => (end === 0 ? { x: -along.value.x, y: -along.value.y } : along.value);

/** The two directions everything is split into: along and across the element, or x and z. */
const directions = computed<[Vec, Vec]>(() =>
  props.system === 'local'
    ? [along.value, normal.value]
    : [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]
);

const forces = computed(() => elementEndForces(props.element, props.loadCase, props.system));
const shapes = computed(() => elementLoadShapes(props.element, props.loadCase, props.system));
const hinges = computed(() => elementHinges(props.element));

/** Forces at the ends and point loads are drawn to one scale, so their sizes can be compared. */
const largestForce = computed(() =>
  Math.max(
    0,
    ...forces.value.flatMap((f) => [Math.abs(f.fx), Math.abs(f.fz)]),
    ...shapes.value.flatMap((s) => (s.kind === 'point' ? [Math.abs(s.fx), Math.abs(s.fz)] : []))
  )
);

const largestIntensity = computed(() =>
  Math.max(
    0,
    ...shapes.value.flatMap((s) =>
      s.kind === 'distributed' ? [s.start.fx, s.start.fz, s.end.fx, s.end.fz].map(Math.abs) : []
    )
  )
);

/** Below this a number is the rounding of a solve, not a force: the zero the solver did not land on. */
const noise = computed(
  () => 1e-9 * Math.max(0, ...forces.value.flatMap((f) => [Math.abs(f.fx), Math.abs(f.fz), Math.abs(f.m)]))
);

interface Text {
  key: string;
  label: Label;
  text: string;
}

const endArrows = computed(() =>
  ends.value.flatMap((point, end) =>
    [forces.value[end].fx, forces.value[end].fz].flatMap((value, i) => {
      const size = Math.abs(value);
      const arrowLength = forceLength(size, largestForce.value);
      if (arrowLength === 0 || size <= noise.value) return [];

      const direction = { x: directions.value[i].x * Math.sign(value), y: directions.value[i].y * Math.sign(value) };
      // one pointing back at the element is drawn arriving, so it stays off the element
      const arriving = direction.x * outward(end).x + direction.y * outward(end).y < -1e-9;

      return [
        { key: `e${end}${i}`, end, ...forceArrow(point, direction, arrowLength, arriving), text: props.show(size) },
      ];
    })
  )
);

const endArcs = computed(() =>
  ends.value.flatMap((point, end) => {
    const m = forces.value[end].m;
    if (Math.abs(m) <= noise.value) return [];

    // the number goes where neither the element nor an arrow at this end already is
    const taken = [
      { x: -outward(end).x, y: -outward(end).y },
      ...endArrows.value
        .filter((a) => a.end === end)
        .map((a) => unit({ x: a.label.x - point.x, y: a.label.y - point.y })),
    ];

    return [
      {
        key: `m${end}`,
        center: point,
        radius: ARC,
        ...momentArc(point, ARC, m > 0, freeDirection(taken)),
        text: props.show(Math.abs(m)),
      },
    ];
  })
);

/**
 * A distributed component across the element is a row of arrows arriving at it, each as long as
 * the intensity there, with their tails joined; one along the element is a line beside it with
 * arrowheads pointing the way it pushes.
 */
const bands = computed(() =>
  shapes.value.flatMap((shape, s) => {
    if (shape.kind !== 'distributed') return [];

    const a = pointAt(shape.from);
    const b = pointAt(shape.to);
    const span = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(2, Math.round(span / 26) + 1);

    return (['fx', 'fz'] as const).flatMap((key, i) => {
      const qa = shape.start[key];
      const qb = shape.end[key];
      if (Math.max(Math.abs(qa), Math.abs(qb)) <= largestIntensity.value * 1e-9) return [];

      const axis = directions.value[i];
      const parallel = Math.abs(axis.x * along.value.x + axis.y * along.value.y) > 0.9;
      const uniform = Math.abs(qa - qb) <= Math.max(Math.abs(qa), Math.abs(qb)) * 1e-9;

      if (parallel) {
        const side = { x: -normal.value.x * 18, y: -normal.value.y * 18 };
        const from = { x: a.x + side.x, y: a.y + side.y };
        const to = { x: b.x + side.x, y: b.y + side.y };
        const sign = Math.sign(qa || qb);
        const direction = { x: axis.x * sign, y: axis.y * sign };
        const heads = Array.from({ length: Math.max(2, count - 1) }, (_, k) => {
          const t = (k + 1) / Math.max(2, count - 1 + 1);
          const at = { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) };
          return forceArrow(at, direction, 10, true).head;
        });
        const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const away = unit(side);
        const texts: Text[] = uniform
          ? [{ key: 'q', label: labelBeyond(middle, away, 8), text: props.show(Math.abs(qa)) }]
          : [
              { key: 'qa', label: labelBeyond(from, away, 8), text: props.show(Math.abs(qa)) },
              { key: 'qb', label: labelBeyond(to, away, 8), text: props.show(Math.abs(qb)) },
            ];

        return [{ key: `d${s}${i}`, line: { from, to }, arrows: [], heads, outline: '', fill: '', texts }];
      }

      const arrows = [];
      const tails: Vec[] = [];

      for (let k = 0; k < count; k++) {
        const t = k / (count - 1);
        const at = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
        const q = qa + t * (qb - qa);

        if (Math.abs(q) <= largestIntensity.value * 1e-9) {
          tails.push(at);
          continue;
        }

        const arrowLength = BAND_MIN + ((BAND - BAND_MIN) * Math.abs(q)) / largestIntensity.value;
        const direction = { x: axis.x * Math.sign(q), y: axis.y * Math.sign(q) };
        const arrow = forceArrow(at, direction, arrowLength, true);

        arrows.push(arrow);
        tails.push(arrow.from);
      }

      const outline = tails.map((p) => `${p.x},${p.y}`).join(' ');
      const fill = `${a.x},${a.y} ${outline} ${b.x},${b.y}`;
      const away = (tail: Vec, at: Vec) => unit({ x: tail.x - at.x, y: tail.y - at.y });
      const middleTail = tails[Math.floor(tails.length / 2)];
      const middleAt = pointAt((shape.from + shape.to) / 2);
      const texts: Text[] = uniform
        ? [{ key: 'q', label: labelBeyond(middleTail, away(middleTail, middleAt), 6), text: props.show(Math.abs(qa)) }]
        : [
            { key: 'qa', label: labelBeyond(tails[0], away(tails[0], a), 6), text: props.show(Math.abs(qa)) },
            { key: 'qb', label: labelBeyond(tails.at(-1)!, away(tails.at(-1)!, b), 6), text: props.show(Math.abs(qb)) },
          ];

      return [{ key: `d${s}${i}`, line: null, arrows, heads: [], outline, fill, texts }];
    });
  })
);

const pointLoads = computed(() =>
  shapes.value.flatMap((shape, s) => {
    if (shape.kind !== 'point') return [];

    const at = pointAt(shape.at);
    const arrows = [shape.fx, shape.fz].flatMap((value, i) => {
      const arrowLength = forceLength(Math.abs(value), largestForce.value);
      if (arrowLength === 0) return [];

      const direction = { x: directions.value[i].x * Math.sign(value), y: directions.value[i].y * Math.sign(value) };

      return [{ key: `p${s}${i}`, ...forceArrow(at, direction, arrowLength, true), text: props.show(Math.abs(value)) }];
    });
    const arcs =
      Math.abs(shape.m) > 0
        ? [
            {
              key: `pm${s}`,
              center: at,
              radius: 16,
              ...momentArc(at, 16, shape.m > 0, { x: -normal.value.x, y: -normal.value.y }),
              text: props.show(Math.abs(shape.m)),
            },
          ]
        : [];

    return [{ key: `p${s}`, arrows, arcs }];
  })
);

const nodeLabels = computed(() =>
  props.element.nodes.map((label, end) => {
    const inward = { x: -outward(end).x, y: -outward(end).y };
    const at = {
      x: ends.value[end].x + inward.x * 18 + normal.value.x * 18,
      y: ends.value[end].y + inward.y * 18 + normal.value.y * 18,
    };

    return { label: String(label), ...at };
  })
);

/** A released end is drawn as the model draws a hinge: an open circle just inside the end. */
const joints = computed(() =>
  ends.value.map((point, end) => {
    const inward = { x: -outward(end).x, y: -outward(end).y };

    return hinges.value[end]
      ? { hinge: true, x: point.x + inward.x * 7, y: point.y + inward.y * 7 }
      : { hinge: false, x: point.x, y: point.y };
  })
);

const viewBox = computed(() =>
  viewBoxAround([
    ...ends.value,
    ...nodeLabels.value.flatMap((n) => textCorners({ ...n, anchor: 'middle' }, n.label, FONT)),
    ...endArrows.value.flatMap((a) => [a.from, a.tip, ...textCorners(a.label, a.text, FONT)]),
    ...[...endArcs.value, ...pointLoads.value.flatMap((p) => p.arcs)].flatMap((a) => [
      { x: a.center.x - a.radius, y: a.center.y - a.radius },
      { x: a.center.x + a.radius, y: a.center.y + a.radius },
      ...textCorners(a.label, a.text, FONT),
    ]),
    ...bands.value.flatMap((b) => [
      ...b.arrows.flatMap((a) => [a.from, a.tip]),
      ...(b.line ? [b.line.from, b.line.to] : []),
      ...b.texts.flatMap((t) => textCorners(t.label, t.text, FONT)),
    ]),
    ...pointLoads.value.flatMap((p) => p.arrows.flatMap((a) => [a.from, a.tip, ...textCorners(a.label, a.text, FONT)])),
  ])
);
</script>

<template>
  <svg class="free-body" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" :style="{ fontSize: `${FONT}px` }">
    <g class="load" :style="{ color: viewerStore.colors.loads }">
      <g v-for="b in bands" :key="b.key">
        <polygon v-if="b.fill" :points="b.fill" class="band" />
        <polyline v-if="b.outline" :points="b.outline" fill="none" />
        <line v-if="b.line" :x1="b.line.from.x" :y1="b.line.from.y" :x2="b.line.to.x" :y2="b.line.to.y" />
        <polygon v-for="(h, i) in b.heads" :key="`h${i}`" :points="h" />
        <g v-for="(a, i) in b.arrows" :key="i">
          <line :x1="a.from.x" :y1="a.from.y" :x2="a.to.x" :y2="a.to.y" />
          <polygon :points="a.head" />
        </g>
        <text v-for="t in b.texts" :key="t.key" :x="t.label.x" :y="t.label.y" :text-anchor="t.label.anchor">
          {{ t.text }}
        </text>
      </g>
      <g v-for="p in pointLoads" :key="p.key">
        <g v-for="a in p.arrows" :key="a.key">
          <line :x1="a.from.x" :y1="a.from.y" :x2="a.to.x" :y2="a.to.y" />
          <polygon :points="a.head" />
          <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">{{ a.text }}</text>
        </g>
        <g v-for="a in p.arcs" :key="a.key">
          <path :d="a.path" fill="none" />
          <polygon :points="a.head" />
          <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">{{ a.text }}</text>
        </g>
      </g>
    </g>

    <line :x1="ends[0].x" :y1="ends[0].y" :x2="ends[1].x" :y2="ends[1].y" class="member" />
    <template v-for="(j, i) in joints" :key="i">
      <circle v-if="j.hinge" :cx="j.x" :cy="j.y" r="5" class="hinge" />
      <circle v-else :cx="j.x" :cy="j.y" r="3" class="joint" />
    </template>
    <text v-for="n in nodeLabels" :key="n.label" :x="n.x" :y="n.y + 5" text-anchor="middle" class="node-label">
      {{ n.label }}
    </text>

    <g class="force">
      <g v-for="a in endArrows" :key="a.key">
        <line :x1="a.from.x" :y1="a.from.y" :x2="a.to.x" :y2="a.to.y" />
        <polygon :points="a.head" />
        <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">{{ a.text }}</text>
      </g>
      <g v-for="a in endArcs" :key="a.key">
        <path :d="a.path" fill="none" />
        <polygon :points="a.head" />
        <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">{{ a.text }}</text>
      </g>
    </g>
  </svg>
</template>

<style scoped>
.free-body {
  width: 100%;
  min-height: 260px;
  flex-grow: 1;
}

.member {
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 3;
}

.joint {
  fill: rgb(var(--v-theme-on-surface));
}

.hinge {
  fill: rgb(var(--v-theme-surface));
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 2;
}

.node-label {
  fill: rgb(var(--v-theme-on-surface));
  opacity: 0.6;
}

/* the element's own end forces take the theme's colour; its loads the drawing's colour for loads */
.force {
  color: rgb(var(--v-theme-primary));
}

.load line,
.load polyline,
.load path,
.force line,
.force path {
  stroke: currentColor;
  stroke-width: 2;
}

.load polygon,
.force polygon {
  fill: currentColor;
}

.load polygon.band {
  fill: currentColor;
  opacity: 0.12;
}

.load text,
.force text {
  fill: currentColor;
  paint-order: stroke;
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 4px;
}
</style>
