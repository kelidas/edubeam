<script setup lang="ts">
import { computed } from 'vue';
import { Beam2D, type LoadCase, type Solver } from 'ts-fem';
import { useI18n } from 'vue-i18n';
import { useViewerStore } from '../store/viewer';
import { nodeEquilibrium, type FreeBodySystem, type NodeContribution } from '../utils/freeBody';
import {
  forceArrow,
  forceLength,
  freeDirection,
  labelBeyond,
  momentArc,
  textCorners,
  unit,
  viewBoxAround,
  type Vec,
} from '../utils/freeBodyDrawing';

/**
 * A node cut out of the structure, with everything acting on it: each element meeting there, the
 * loads put on it and its support. The table adds them up in the global system.
 */
const props = defineProps<{
  solver: Solver;
  node: string;
  loadCase: LoadCase;
  system: FreeBodySystem;
  /** How a number is written: the widget's own way, so the drawing reads like its tables. */
  show: (value: number) => string;
}>();

const { t } = useI18n();
const viewerStore = useViewerStore();

/**
 * How far each element is drawn from the node, and where on it its force acts: further out than
 * the longest arrow, so none reaches across the node.
 */
const STUB = 170;
const AT = 100;
const FONT = 15;

const equilibrium = computed(() => nodeEquilibrium(props.solver, props.node, props.loadCase));

/** Which way each element leaves the node, as a unit vector in the drawing. */
const stubs = computed(() => {
  const here = props.solver.domain.nodes.get(props.node)?.coords;
  const directions = new Map<string, Vec>();
  if (!here) return directions;

  for (const element of props.solver.domain.elements.values()) {
    if (!(element instanceof Beam2D)) continue;

    const end = element.nodes.findIndex((n) => String(n) === props.node);
    if (end < 0) continue;

    const other = props.solver.domain.nodes.get(String(element.nodes[1 - end]));
    if (!other) continue;

    directions.set(String(element.label), unit({ x: other.coords[0] - here[0], y: other.coords[2] - here[2] }));
  }

  return directions;
});

const contributions = computed(() => equilibrium.value.contributions);

/** Below this a number is the rounding of a solve, not a force: the zero the solver did not land on. */
const noise = computed(
  () => 1e-9 * Math.max(0, ...contributions.value.flatMap((c) => [Math.abs(c.fx), Math.abs(c.fz), Math.abs(c.m)]))
);

const color = (c: NodeContribution) =>
  c.kind === 'load' ? viewerStore.colors.loads : c.kind === 'reaction' ? viewerStore.colors.reactions : undefined;

/**
 * The two directions a contribution is split into. An element's force, in the local system, goes
 * along that element and across it - its axial force and its shear; everything else, and every
 * force in the global system, goes along x and z.
 */
const split = (c: NodeContribution): [Vec, Vec] => {
  const stub = c.kind === 'element' ? stubs.value.get(c.label ?? '') : undefined;

  return props.system === 'local' && stub
    ? [stub, { x: -stub.y, y: stub.x }]
    : [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ];
};

const components = computed(() =>
  contributions.value.map((c) => {
    const [first, second] = split(c);

    return [
      { axis: first, value: c.fx * first.x + c.fz * first.y },
      { axis: second, value: c.fx * second.x + c.fz * second.y },
    ];
  })
);

const largest = computed(() => Math.max(0, ...components.value.flat().map((p) => Math.abs(p.value))));

/** Where a contribution acts: on its element, for an element's force; on the node itself otherwise. */
const anchor = (c: NodeContribution): { at: Vec; stub?: Vec } => {
  const stub = c.kind === 'element' ? stubs.value.get(c.label ?? '') : undefined;
  return stub ? { at: { x: stub.x * AT, y: stub.y * AT }, stub } : { at: { x: 0, y: 0 } };
};

/**
 * An element's force is drawn on the element, leaving the point it acts at: pointing at the node it
 * pushes, pointing away it pulls - as a joint is drawn in the method of joints. A load and a
 * reaction act on the node itself and are drawn arriving at it, so the two do not lie on each other.
 */
const arrows = computed(() =>
  contributions.value.flatMap((c, i) =>
    components.value[i].flatMap(({ axis, value }, k) => {
      const size = Math.abs(value);
      const length = forceLength(size, largest.value);
      if (length === 0 || size <= noise.value) return [];

      const { at, stub } = anchor(c);
      const direction = { x: axis.x * Math.sign(value), y: axis.y * Math.sign(value) };

      const arrow = forceArrow(at, direction, length, !stub);

      // an element's arrow pointing at the node would write its number on the node: it goes at the tail
      if (stub && Math.hypot(arrow.tip.x, arrow.tip.y) < Math.hypot(arrow.from.x, arrow.from.y)) {
        arrow.label = labelBeyond(arrow.from, { x: -direction.x, y: -direction.y });
      }

      return [{ key: `${i}${k}`, at, ...arrow, color: color(c), text: props.show(size) }];
    })
  )
);

/** Which way from a point the numbers already written there lie. */
const labelsFrom = (at: Vec) =>
  arrows.value
    .filter((a) => a.at.x === at.x && a.at.y === at.y)
    .map((a) => unit({ x: a.label.x - at.x, y: a.label.y - at.y }));

const arcs = computed(() => {
  const nodeTaken: Vec[] = [...stubs.value.values(), ...labelsFrom({ x: 0, y: 0 })];
  let around = 0;

  return contributions.value.flatMap((c, i) => {
    if (Math.abs(c.m) <= noise.value) return [];

    const { at, stub } = anchor(c);
    // the node's own moments nest around it, each a little wider than the last
    const radius = stub ? 16 : 26 + 10 * around++;
    // a number goes where nothing else around the same point does
    const taken = stub ? [stub, { x: -stub.x, y: -stub.y }, ...labelsFrom(at)] : nodeTaken;
    const facing = freeDirection(taken);
    if (!stub) nodeTaken.push(facing);

    return [
      {
        key: i,
        at,
        radius,
        ...momentArc(at, radius, c.m > 0, facing),
        color: color(c),
        text: props.show(Math.abs(c.m)),
      },
    ];
  });
});

const elementLabels = computed(() =>
  [...stubs.value].map(([element, d]) => ({
    element,
    end: { x: d.x * STUB, y: d.y * STUB },
    ...labelBeyond({ x: d.x * STUB, y: d.y * STUB }, d),
  }))
);

const viewBox = computed(() =>
  viewBoxAround([
    { x: 0, y: 0 },
    ...elementLabels.value.flatMap((l) => [l.end, ...textCorners(l, l.element, FONT)]),
    ...arrows.value.flatMap((a) => [a.from, a.tip, ...textCorners(a.label, a.text, FONT)]),
    ...arcs.value.flatMap((a) => [
      { x: a.at.x - a.radius, y: a.at.y - a.radius },
      { x: a.at.x + a.radius, y: a.at.y + a.radius },
      ...textCorners(a.label, a.text, FONT),
    ]),
  ])
);

/** What is left of a sum that should be nothing: rounding, shown as the zero it is. */
const cleaned = (value: number) => (Math.abs(value) <= noise.value ? 0 : value);

const name = (c: NodeContribution) =>
  c.kind === 'element'
    ? `${t('common.element')} ${c.label}`
    : c.kind === 'load'
      ? t('freeBody.load')
      : t('freeBody.reaction');

const rows = computed(() => {
  const format = (c: { fx: number; fz: number; m: number }) => [c.fx, c.fz, c.m].map((v) => props.show(cleaned(v)));
  const sum = equilibrium.value.sum;

  return {
    parts: contributions.value.map((c, i) => ({ key: i, name: name(c), color: color(c), values: format(c) })),
    sum: format(sum),
    balanced: [sum.fx, sum.fz, sum.m].every((v) => cleaned(v) === 0),
  };
});
</script>

<template>
  <div class="d-flex flex-column flex-grow-1">
    <div v-if="rows.balanced" class="flex-shrink-0">
      <v-chip size="small" color="success" label prepend-icon="mdi-check">{{ $t('freeBody.balanced') }}</v-chip>
    </div>
    <svg class="free-body" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" :style="{ fontSize: `${FONT}px` }">
      <g class="members">
        <line v-for="s in elementLabels" :key="s.element" x1="0" y1="0" :x2="s.end.x" :y2="s.end.y" />
        <text v-for="s in elementLabels" :key="`t${s.element}`" :x="s.x" :y="s.y" :text-anchor="s.anchor">
          {{ s.element }}
        </text>
      </g>
      <circle cx="0" cy="0" r="5" class="joint" />

      <g v-for="a in arrows" :key="a.key" class="force" :style="a.color ? { color: a.color } : undefined">
        <line :x1="a.from.x" :y1="a.from.y" :x2="a.to.x" :y2="a.to.y" />
        <polygon :points="a.head" />
        <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">{{ a.text }}</text>
      </g>

      <g v-for="a in arcs" :key="`m${a.key}`" class="force" :style="a.color ? { color: a.color } : undefined">
        <path :d="a.path" fill="none" />
        <polygon :points="a.head" />
        <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">{{ a.text }}</text>
      </g>
    </svg>

    <!-- the sum only means something in one system, so the table stays global whatever is drawn -->
    <v-table class="border text-right flex-shrink-0" density="compact" style="white-space: nowrap">
      <thead>
        <tr>
          <th></th>
          <th class="text-right px-2 font-weight-regular">u</th>
          <th class="text-right px-2 font-weight-regular">w</th>
          <th class="text-right px-2 font-weight-regular">φ</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows.parts" :key="r.key">
          <th class="text-left px-2 font-weight-regular" :style="r.color ? { color: r.color } : undefined">
            {{ r.name }}
          </th>
          <td v-for="(v, j) in r.values" :key="j" class="px-2">{{ v }}</td>
        </tr>
        <tr class="font-weight-bold">
          <th class="text-left px-2">Σ</th>
          <td v-for="(v, j) in rows.sum" :key="j" class="px-2">{{ v }}</td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<style scoped>
.free-body {
  width: 100%;
  min-height: 260px;
  flex-grow: 1;
}

.members line {
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 3;
  opacity: 0.35;
}

.members text {
  fill: rgb(var(--v-theme-on-surface));
  opacity: 0.7;
}

.joint {
  fill: rgb(var(--v-theme-surface));
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 1.5;
}

/* an element's force takes the theme's colour; a load and a reaction the drawing's own for them */
.force {
  color: rgb(var(--v-theme-primary));
}

.force line,
.force path {
  stroke: currentColor;
  stroke-width: 2;
}

.force polygon {
  fill: currentColor;
}

.force text {
  fill: currentColor;
  paint-order: stroke;
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 4px;
}

table td + td,
table th + td,
thead th + th {
  border-left: 1px solid #dddddd;
}
</style>
