<script setup lang="ts">
import { computed } from 'vue';
import { Beam2D } from 'ts-fem';
import { useI18n } from 'vue-i18n';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';
import { useViewerStore } from '@/store/viewer';
import { nodeEquilibrium, type NodeContribution } from '@/utils/freeBody';
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
} from '@/utils/freeBodyDrawing';

const props = defineProps<{ node: string | number }>();

const { t } = useI18n();
const projectStore = useProjectStore();
const appStore = useAppStore();
const viewerStore = useViewerStore();

/**
 * How far each element is drawn from the node, and where on it its force acts: further out than
 * the longest arrow, so none reaches across the node.
 */
const STUB = 170;
const AT = 100;

const label = computed(() => String(props.node));

/** The widget stays open while the model changes, so the node may be gone by now. */
const found = computed(() => projectStore.solver.domain.nodes.get(label.value));

const loadCase = computed(() => projectStore.solver.loadCases[0]);

const equilibrium = computed(() =>
  found.value && loadCase.value?.solved ? nodeEquilibrium(projectStore.solver, label.value, loadCase.value) : null
);

/** Which way each element leaves the node, as a unit vector in the drawing. */
const stubs = computed(() => {
  const here = found.value?.coords;
  if (!here) return new Map<string, Vec>();

  const directions = new Map<string, Vec>();

  for (const element of projectStore.solver.domain.elements.values()) {
    if (!(element instanceof Beam2D)) continue;

    const end = element.nodes.findIndex((n) => String(n) === label.value);
    if (end < 0) continue;

    const other = projectStore.solver.domain.nodes.get(String(element.nodes[1 - end]));
    if (!other) continue;

    const dx = other.coords[0] - here[0];
    const dz = other.coords[2] - here[2];
    const length = Math.hypot(dx, dz) || 1;

    directions.set(String(element.label), { x: dx / length, y: dz / length });
  }

  return directions;
});

const contributions = computed(() => equilibrium.value?.contributions ?? []);

const largest = computed(() => Math.max(0, ...contributions.value.map((c) => Math.hypot(c.fx, c.fz))));

/** Below this a value is the rounding of a solve, not a force: zero the solver did not land on. */
const noise = computed(
  () => 1e-9 * Math.max(0, ...contributions.value.flatMap((c) => [Math.abs(c.fx), Math.abs(c.fz), Math.abs(c.m)]))
);

const show = (value: number) => appStore.formatResultText(value === 0 ? 0 : value);
const force = (value: number) => `${show(appStore.convertForce(Math.abs(value)))} ${appStore.units.Force}`;
const moment = (value: number) => `${show(appStore.convertMoment(Math.abs(value)))} ${appStore.units.Moment}`;

const color = (c: NodeContribution) =>
  c.kind === 'load' ? viewerStore.colors.loads : c.kind === 'reaction' ? viewerStore.colors.reactions : undefined;

const name = (c: NodeContribution) =>
  c.kind === 'element'
    ? `${t('common.element')} ${c.label}`
    : c.kind === 'load'
      ? t('freeBody.load')
      : t('freeBody.reaction');

/** Where on its element an element's force is drawn acting; the node itself for anything else. */
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
  contributions.value.flatMap((c, i) => {
    const size = Math.hypot(c.fx, c.fz);
    const length = forceLength(size, largest.value);
    if (length === 0 || size <= noise.value) return [];

    const { at, stub } = anchor(c);
    const letter = c.kind === 'reaction' ? 'R' : 'F';

    return [
      {
        key: i,
        at,
        ...forceArrow(at, { x: c.fx / size, y: c.fz / size }, length, !stub),
        size,
        color: color(c),
        text: `${letter} = ${force(size)}`,
      },
    ];
  })
);

/** Which way from a point the labels already drawn there lie. */
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
    // a label goes where nothing else around the same point does
    const taken = stub ? [stub, { x: -stub.x, y: -stub.y }, ...labelsFrom(at)] : nodeTaken;
    const facing = freeDirection(taken);
    if (!stub) nodeTaken.push(facing);

    return [
      {
        key: i,
        at,
        radius,
        ...momentArc(at, radius, c.m > 0, facing),
        value: c.m,
        color: color(c),
        text: `M${appStore.axes.r} = ${moment(c.m)}`,
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
    ...elementLabels.value.flatMap((l) => [l.end, ...textCorners(l, l.element)]),
    ...arrows.value.flatMap((a) => [a.from, a.tip, ...textCorners(a.label, a.text)]),
    ...arcs.value.flatMap((a) => [
      { x: a.at.x - a.radius, y: a.at.y - a.radius },
      { x: a.at.x + a.radius, y: a.at.y + a.radius },
      ...textCorners(a.label, a.text),
    ]),
  ])
);

/** What is left of a sum that should be nothing: rounding, shown as the zero it is. */
const cleaned = (value: number) => (Math.abs(value) <= noise.value ? 0 : value);

const rows = computed(() => {
  const format = (c: { fx: number; fz: number; m: number }) => ({
    fx: show(appStore.convertForce(cleaned(c.fx))),
    fz: show(appStore.convertForce(appStore.vertical(cleaned(c.fz)))),
    m: show(appStore.convertMoment(cleaned(c.m))),
  });

  const sum = equilibrium.value?.sum ?? { fx: 0, fz: 0, m: 0 };

  return {
    parts: contributions.value.map((c, i) => ({ key: i, name: name(c), color: color(c), ...format(c) })),
    sum: format(sum),
    balanced: [sum.fx, sum.fz, sum.m].every((v) => cleaned(v) === 0),
  };
});
</script>

<template>
  <div class="fill-height d-flex flex-column">
    <div v-if="!found" class="pa-3">{{ $t('freeBody.nodeMissing', { label }) }}</div>
    <div v-else-if="!equilibrium" class="pa-3 text-medium-emphasis">{{ $t('freeBody.notSolved') }}</div>
    <template v-else>
      <div class="d-flex align-center ga-2 px-2 pt-2 flex-shrink-0 text-caption">
        <v-chip v-if="rows.balanced" size="small" color="success" label prepend-icon="mdi-check">
          {{ $t('freeBody.balanced') }}
        </v-chip>
        <span class="text-medium-emphasis ml-auto">{{ $t('freeBody.nodeHint') }}</span>
      </div>

      <svg class="free-body flex-grow-1" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
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
          <!-- prettier-ignore -->
          <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">M<tspan dy="3" font-size="9">{{ appStore.axes.r }}</tspan><tspan dy="-3"> = {{ moment(a.value) }}</tspan></text>
        </g>
      </svg>

      <v-table density="compact" class="flex-shrink-0 border-t text-right">
        <thead>
          <tr>
            <th class="text-left"></th>
            <th class="text-right">F<sub>x</sub> [{{ appStore.units.Force }}]</th>
            <th class="text-right">
              F<sub>{{ appStore.axes.v }}</sub> [{{ appStore.units.Force }}]
            </th>
            <th class="text-right">
              M<sub>{{ appStore.axes.r }}</sub> [{{ appStore.units.Moment }}]
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows.parts" :key="r.key">
            <td class="text-left" :style="r.color ? { color: r.color } : undefined">{{ r.name }}</td>
            <td>{{ r.fx }}</td>
            <td>{{ r.fz }}</td>
            <td>{{ r.m }}</td>
          </tr>
          <tr class="font-weight-bold">
            <td class="text-left">Σ</td>
            <td>{{ rows.sum.fx }}</td>
            <td>{{ rows.sum.fz }}</td>
            <td>{{ rows.sum.m }}</td>
          </tr>
        </tbody>
      </v-table>
    </template>
  </div>
</template>

<style scoped>
/* the drawing keeps a readable size; a widget made smaller than that scrolls instead */
.free-body {
  min-height: 240px;
  font-size: 12px;
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
  stroke-width: 3px;
}
</style>
