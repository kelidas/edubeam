<script setup lang="ts">
import { computed, ref } from 'vue';
import { Beam2D } from 'ts-fem';
import { useProjectStore } from '@/store/project';
import { useAppStore } from '@/store/app';
import { elementAxes, elementEndForces, type PointForce } from '@/utils/freeBody';
import {
  forceArrow,
  forceLength,
  freeDirection,
  momentArc,
  textCorners,
  unit,
  viewBoxAround,
  type Vec,
} from '@/utils/freeBodyDrawing';

const props = defineProps<{ label: string | number }>();

const projectStore = useProjectStore();
const appStore = useAppStore();

const system = ref<'local' | 'global'>('local');

/** Half the drawn element, in drawing units; the element is drawn the same size whatever its length. */
const HALF = 110;
const ARC = 24;

/** The widget stays open while the model changes, so the element may be gone by now. */
const element = computed(() => {
  const found = projectStore.solver.domain.elements.get(String(props.label));
  return found instanceof Beam2D ? found : undefined;
});

/** The case the open tab is about: an influence line's unit dislocation is solved and balanced too. */
const loadCase = computed(() => projectStore.loadCase ?? projectStore.solver.loadCases[0]);

const forces = computed(() =>
  element.value && loadCase.value?.solved ? elementEndForces(element.value, loadCase.value)[system.value] : null
);

const axes = computed(() => (element.value ? elementAxes(element.value) : null));

const along = computed<Vec>(() => ({ x: axes.value?.along.x ?? 1, y: axes.value?.along.z ?? 0 }));
const normal = computed<Vec>(() => ({ x: axes.value?.normal.x ?? 0, y: axes.value?.normal.z ?? 1 }));

const ends = computed<Vec[]>(() => [
  { x: -HALF * along.value.x, y: -HALF * along.value.y },
  { x: HALF * along.value.x, y: HALF * along.value.y },
]);

/** Away from the element at each of its ends. */
const outward = (end: number): Vec => (end === 0 ? { x: -along.value.x, y: -along.value.y } : along.value);

/** The two directions forces are split into: along and across the element, or x and z. */
const directions = computed<[Vec, Vec]>(() =>
  system.value === 'local'
    ? [along.value, normal.value]
    : [
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ]
);

const largest = computed(() => Math.max(0, ...(forces.value ?? []).flatMap((f) => [Math.abs(f.fx), Math.abs(f.fz)])));

/** Below this a component is the rounding of a solve, not a force: zero the solver did not land on. */
const noise = computed(
  () => 1e-9 * Math.max(0, ...(forces.value ?? []).flatMap((f) => [Math.abs(f.fx), Math.abs(f.fz), Math.abs(f.m)]))
);

const show = (value: number) => appStore.formatResultText(value === 0 ? 0 : value);
const force = (value: number) => `${show(appStore.convertForce(Math.abs(value)))} ${appStore.units.Force}`;
const moment = (value: number) => `${show(appStore.convertMoment(Math.abs(value)))} ${appStore.units.Moment}`;

/** A prime marks a component in the element's own axes. */
const mark = computed(() => (system.value === 'local' ? '′' : ''));
const subscripts = computed(() => [`x${mark.value}`, `${appStore.axes.v}${mark.value}`]);

const arrows = computed(() => {
  const f = forces.value;
  if (!f) return [];

  return ends.value.flatMap((point, end) =>
    [f[end].fx, f[end].fz].flatMap((value, i) => {
      const length = forceLength(value, largest.value);
      if (length === 0 || Math.abs(value) <= noise.value) return [];

      const sign = Math.sign(value);
      const direction = { x: directions.value[i].x * sign, y: directions.value[i].y * sign };
      // one pointing back at the element is drawn arriving, so it stays off the element
      const arriving = direction.x * outward(end).x + direction.y * outward(end).y < -1e-9;
      const sub = subscripts.value[i];

      return [
        {
          key: `${end}-${i}`,
          end,
          ...forceArrow(point, direction, length, arriving),
          sub,
          value,
          text: `F${sub} = ${force(value)}`,
        },
      ];
    })
  );
});

const arcs = computed(() => {
  const f = forces.value;
  if (!f) return [];

  return ends.value.flatMap((point, end) => {
    if (Math.abs(f[end].m) <= noise.value) return [];

    // its label goes where neither the element nor an arrow at this end does
    const taken = [
      { x: -outward(end).x, y: -outward(end).y },
      ...arrows.value.filter((a) => a.end === end).map((a) => unit({ x: a.label.x - point.x, y: a.label.y - point.y })),
    ];

    return [
      {
        key: `m${end}`,
        center: point,
        ...momentArc(point, ARC, f[end].m > 0, freeDirection(taken)),
        value: f[end].m,
        text: `M${appStore.axes.r} = ${moment(f[end].m)}`,
      },
    ];
  });
});

const nodeLabels = computed(() =>
  (element.value?.nodes ?? []).map((label, end) => {
    const inward = { x: -outward(end).x, y: -outward(end).y };

    return {
      label: String(label),
      x: ends.value[end].x + inward.x * 16 - normal.value.x * 14,
      y: ends.value[end].y + inward.y * 16 - normal.value.y * 14,
    };
  })
);

const viewBox = computed(() =>
  viewBoxAround([
    ...ends.value,
    ...nodeLabels.value,
    ...arrows.value.flatMap((a) => [a.from, a.tip, ...textCorners(a.label, a.text)]),
    ...arcs.value.flatMap((a) => [
      { x: a.center.x - ARC, y: a.center.y - ARC },
      { x: a.center.x + ARC, y: a.center.y + ARC },
      ...textCorners(a.label, a.text),
    ]),
  ])
);

/** The table's numbers carry their signs, read in the chosen convention: up is up if y is. */
const rows = computed(() =>
  (forces.value ?? []).map((f: PointForce, end) => ({
    node: String(element.value?.nodes[end] ?? ''),
    fx: show(appStore.convertForce(f.fx)),
    fz: show(appStore.convertForce(appStore.vertical(f.fz))),
    m: show(appStore.convertMoment(f.m)),
  }))
);
</script>

<template>
  <div class="fill-height d-flex flex-column">
    <div v-if="!element" class="pa-3">{{ $t('warnings.elementMissing', { label: String(props.label) }) }}</div>
    <div v-else-if="!forces" class="pa-3 text-medium-emphasis">{{ $t('freeBody.notSolved') }}</div>
    <template v-else>
      <div class="d-flex align-center ga-2 px-2 pt-2 flex-shrink-0">
        <v-btn-toggle v-model="system" density="compact" mandatory variant="outlined" divided>
          <v-btn value="local" size="small" class="text-none">{{ $t('freeBody.local') }}</v-btn>
          <v-btn value="global" size="small" class="text-none">{{ $t('freeBody.global') }}</v-btn>
        </v-btn-toggle>
        <span class="text-caption text-medium-emphasis ml-auto">{{ $t('freeBody.elementHint') }}</span>
      </div>

      <svg class="free-body flex-grow-1" :viewBox="viewBox" preserveAspectRatio="xMidYMid meet">
        <line :x1="ends[0].x" :y1="ends[0].y" :x2="ends[1].x" :y2="ends[1].y" class="member" />
        <circle v-for="(p, i) in ends" :key="i" :cx="p.x" :cy="p.y" r="4" class="joint" />
        <text v-for="n in nodeLabels" :key="n.label" :x="n.x" :y="n.y" text-anchor="middle" class="node-label">
          {{ n.label }}
        </text>

        <g v-for="a in arrows" :key="a.key" class="force">
          <line :x1="a.from.x" :y1="a.from.y" :x2="a.to.x" :y2="a.to.y" />
          <polygon :points="a.head" />
          <!-- prettier-ignore -->
          <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">F<tspan dy="3" font-size="9">{{ a.sub }}</tspan><tspan dy="-3"> = {{ force(a.value) }}</tspan></text>
        </g>

        <g v-for="a in arcs" :key="a.key" class="force">
          <path :d="a.path" fill="none" />
          <polygon :points="a.head" />
          <!-- prettier-ignore -->
          <text :x="a.label.x" :y="a.label.y" :text-anchor="a.label.anchor">M<tspan dy="3" font-size="9">{{ appStore.axes.r }}</tspan><tspan dy="-3"> = {{ moment(a.value) }}</tspan></text>
        </g>
      </svg>

      <v-table density="compact" class="flex-shrink-0 border-t text-right">
        <thead>
          <tr>
            <th class="text-left">{{ $t('common.node') }}</th>
            <th class="text-right">
              F<sub>{{ subscripts[0] }}</sub> [{{ appStore.units.Force }}]
            </th>
            <th class="text-right">
              F<sub>{{ subscripts[1] }}</sub> [{{ appStore.units.Force }}]
            </th>
            <th class="text-right">
              M<sub>{{ appStore.axes.r }}</sub> [{{ appStore.units.Moment }}]
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.node">
            <td class="text-left">{{ r.node }}</td>
            <td>{{ r.fx }}</td>
            <td>{{ r.fz }}</td>
            <td>{{ r.m }}</td>
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

.member {
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 3;
}

.joint {
  fill: rgb(var(--v-theme-surface));
  stroke: rgb(var(--v-theme-on-surface));
  stroke-width: 1.5;
}

.node-label {
  fill: rgb(var(--v-theme-on-surface));
  opacity: 0.7;
}

.force line,
.force path {
  stroke: rgb(var(--v-theme-primary));
  stroke-width: 2;
}

.force polygon {
  fill: rgb(var(--v-theme-primary));
}

.force text {
  fill: rgb(var(--v-theme-primary));
  paint-order: stroke;
  stroke: rgb(var(--v-theme-surface));
  stroke-width: 3px;
}
</style>
