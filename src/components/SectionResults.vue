<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Beam2D } from 'ts-fem';
import { useProjectStore } from '../store/project';
import { useAppStore } from '../store/app';
import { MEASURED_AT, widthOf } from '../utils/labelWidth';
import { formatResultAsText } from '../utils/numberDisplay';
import { extremesOf, type SectionQuantity, type SectionResult } from '../utils/sectionResults';
import {
  chainJumpsOf,
  chainOf,
  chainResultsAlong,
  chainResultsAt,
  chainStationaryPoints,
  collinearRun,
} from '../utils/sectionChain';

const projectStore = useProjectStore();
const appStore = useAppStore();

const props = defineProps<{
  label: string;
}>();

/**
 * How many pieces the element is cut into. Eight gives a section every eighth of the span, which is
 * what a hand calculation would tabulate; the ends are always there on top of that.
 */
const divisions = ref(8);

/** A section the reader asks for by hand or points at in the diagram, in the length unit on show. */
const position = ref<number | null>(null);

/**
 * How far apart the sections the pointer can land on are. Held in metres so it survives a change of
 * unit, and a centimetre to begin with, which is finer than anyone reads a beam to and about one
 * pixel of the diagram at a usual span.
 *
 * Without one the step was a pixel of the diagram - so it changed with the width of the window and
 * with the length of the beam, and gave positions like 0.98252 m, which is a reading of the screen
 * rather than of the structure.
 */
const stepInMetres = ref(0.01);

const step = computed({
  get: () => appStore.convertLength(stepInMetres.value),
  set: (value: number) => {
    if (Number.isFinite(value) && value > 0) stepInMetres.value = appStore.convertInverseLength(value);
  },
});

/** Which quantity the diagram draws. The table shows them all regardless. */
const drawn = ref<SectionQuantity>('my');

const element = computed(() => {
  const found = projectStore.solver.domain.elements.get(props.label);

  return found instanceof Beam2D ? found : null;
});

/**
 * The straight run of elements this one belongs to - a continuous beam modelled span by span - and
 * whether to read all of it rather than this element alone. Off to begin with, so the widget opens
 * on the element it was asked about.
 */
const run = computed(() => (element.value ? collinearRun(projectStore.solver, element.value) : []));
const whole = ref(false);

/**
 * What is read: the element alone, or the whole run, laid end to end and pointing the way this
 * element does so switching between the two does not turn its numbers over.
 */
const chain = computed(() => {
  if (!element.value) return null;

  return chainOf(whole.value && run.value.length > 1 ? run.value : [element.value], element.value);
});

const usable = computed(() => {
  const parts = chain.value?.parts ?? [];

  if (parts.length === 0) return false;

  return parts.every(
    ({ element: el }) =>
      !!projectStore.solver.domain.materials.get(el.mat) && !!projectStore.solver.domain.crossSections.get(el.cs)
  );
});

/**
 * The case being read, which is the one the open tab is about: the real loads in the viewer, the
 * unit dislocations in the influence line workspace - falling back to the only case there is where
 * the app has no second workspace to speak of. The widget floats above both tabs and stays
 * open across them, so it follows whichever is on screen - and says which, since otherwise the
 * numbers would change under the reader with nothing to explain it.
 */
const loadCase = computed(() => projectStore.loadCase ?? projectStore.solver.loadCases[0]);

const solved = computed(() => usable.value && loadCase.value?.solved === true);

const length = computed(() => chain.value?.length ?? 0);

const sections = computed<SectionResult[]>(() =>
  solved.value ? chainResultsAlong(chain.value!, loadCase.value, divisions.value) : []
);

/** The one section asked for, if any. It is clamped onto the element, so it is always a real one. */
const asked = computed<SectionResult | null>(() => {
  if (!solved.value || position.value === null || !Number.isFinite(position.value)) return null;

  return chainResultsAt(chain.value!, loadCase.value, appStore.convertInverseLength(position.value));
});

const extremes = computed(() => extremesOf(sections.value));

interface Quantity {
  key: SectionQuantity;
  name: string;
  unit: string;
  convert: (value: number) => number;
}

/**
 * Each of these carries one unit, unlike a stiffness matrix, so they are shown converted and
 * labelled - a shear in kN next to a deflection in mm is what anyone reading a section wants. A
 * rotation is in radians, which is not a unit the app converts.
 */
const quantities = computed<Quantity[]>(() => [
  { key: 'n', name: 'N', unit: appStore.units.Force, convert: appStore.convertForce },
  { key: 'vz', name: 'V', unit: appStore.units.Force, convert: appStore.convertForce },
  { key: 'my', name: 'M', unit: appStore.units.Moment, convert: appStore.convertMoment },
  { key: 'u', name: 'u', unit: appStore.units.Length, convert: appStore.convertLength },
  { key: 'w', name: 'w', unit: appStore.units.Length, convert: appStore.convertLength },
  { key: 'phi', name: 'φ', unit: 'rad', convert: (value: number) => value },
]);

const quantityOf = (key: SectionQuantity) => quantities.value.find((q) => q.key === key)!;

/**
 * The nodes along what is read, named - the two ends of an element, and every joint of a run.
 *
 * The element is drawn straight here whatever its angle, so which end is which is not something the
 * picture can say on its own - and x is measured from the first of them, which is the one fact the
 * whole table rests on.
 */
const ends = computed(() => chain.value?.nodes ?? []);

/**
 * Numerical noise written as zero.
 *
 * A quantity that is zero at a section comes back from the solve as something like 9·10⁻¹⁶ - the
 * residue of adding and subtracting numbers of the order of the peak. At five significant figures
 * that reads as a value, and a diagram label of "9.09·10⁻¹⁶" at a free end is worse than useless.
 * The test is relative to the largest value of the same quantity, so a genuinely small result -
 * an axial shortening of a micrometre next to a millimetre of deflection - is left alone.
 */
const clean = (value: number, key?: SectionQuantity) => {
  if (key && Math.abs(value) < 1e-9 * (peaks.value[key] || 0)) return 0;

  return Object.is(value, -0) ? 0 : value;
};

const show = (value: number, key?: SectionQuantity) => appStore.formatResultText(clean(value, key));

/**
 * Positions along the element, which are read differently from the results beside them: a section
 * at a third of a six metre beam is 2 m, not 2·10⁰, whatever exponent style the results are set to.
 * The plain range is wide enough that a distance almost always falls inside it.
 */
const showLength = (value: number) => formatResultAsText(value, 'auto', appStore.resultFormatter);

/** Three figures rather than five, for the labels in the diagram, where space is the constraint. */
const diagramFormatter = computed(
  () =>
    new Intl.NumberFormat(appStore.resultFormatter.resolvedOptions().locale, {
      maximumSignificantDigits: 3,
    })
);

const showBriefly = (value: number, key?: SectionQuantity) =>
  formatResultAsText(clean(value, key), appStore.numberStyle, diagramFormatter.value);

/** The largest of each quantity across the sections shown, which is what the bars are drawn to. */
const largest = computed<Record<SectionQuantity, number>>(() => {
  const found = {} as Record<SectionQuantity, number>;

  for (const { key } of quantities.value) {
    found[key] = sections.value.reduce((max, section) => Math.max(max, Math.abs(section[key])), 0);
  }

  return found;
});

/**
 * The same, over the finely sampled curve rather than the table: what counts as noise should not
 * change when the division count does.
 */
const peaks = computed<Record<SectionQuantity, number>>(() => {
  const found = {} as Record<SectionQuantity, number>;

  for (const { key } of quantities.value) {
    found[key] = curve.value.reduce((max, section) => Math.max(max, Math.abs(section[key])), 0);
  }

  return found;
});

/**
 * A bar beside the number, from the middle of the cell: right for positive, left for negative.
 *
 * The shape of a diagram is the thing a table hides - a column of numbers does not show where the
 * moment peaks or where the shear changes sign the way a drawing does. It is drawn as a strip under
 * the number rather than as the cell's background, because the app paints table rows with an
 * `!important` background of its own, which would take any background image with it.
 */
const bar = (section: SectionResult, key: SectionQuantity) => {
  const max = largest.value[key];
  const ratio = max ? section[key] / max : 0;
  const half = 50 * Math.abs(ratio);

  return { left: ratio < 0 ? `${50 - half}%` : '50%', width: `${half}%` };
};

// ---------------------------------------------------------------------------
// The diagram
// ---------------------------------------------------------------------------

/**
 * The element drawn straight, whatever its angle, with one quantity plotted across it.
 *
 * A table gives exact numbers but not the shape, and the shape is half of what a section result
 * means: where the moment peaks, where the shear changes sign, which way the beam bends. Positive
 * is drawn downwards, the way the main drawing plots the same quantities, so the two agree.
 *
 * Pointing at it sets the section - which is the "walk along the beam and watch the numbers" idea,
 * costing nothing extra here because the widget is already showing one section at a time.
 */
const plot = ref<SVGSVGElement | null>(null);
const plotWidth = ref(320);

/**
 * How large the numbers on the diagram are written, and everything that follows from it.
 *
 * The rest of the drawing is laid out in proportion to this rather than in fixed pixels, so the
 * size is the only thing to change: how far a label sits from its point, how far apart two of them
 * have to be before they are on the same line, and how wide a number will be written.
 */
const LABEL_SIZE = 12;
const em = LABEL_SIZE / MEASURED_AT;

/**
 * The ring a node's name sits in, sized the way the drawing sizes its own.
 *
 * Half the font plus a little is what makes a ring look drawn around a character rather than a
 * character dropped into a hoop, and growing it with the length of the name keeps a node called
 * "left" inside its ring rather than spilling out of it.
 */
const ringAround = (node: string) => 1 + (LABEL_SIZE / 2) * (1 + Math.pow(String(node).length - 1, 1.7) * 0.3);

const PAD_X = 10;
/** How far the curve reaches either side of the axis at its peak. */
const REACH = Math.round(46 * em);
/** The space between the end of an ordinate and the number written beyond it. */
const GAP = 4 * em;

let observer: ResizeObserver | null = null;

/*
 * The drawing is taken out of the page and put back whenever the element briefly goes missing - and
 * a change made from the bottom bar rebuilds the whole model, so it does. The observer has to follow
 * whichever drawing is there now: left on the old one, it heard that drawing report no width as it
 * was removed, and the new one was never measured, so the diagram stayed at its narrowest.
 */
watch(
  plot,
  (element, previous) => {
    if (previous) observer?.unobserve(previous);
    if (!element || typeof ResizeObserver === 'undefined') return;

    observer ??= new ResizeObserver(([entry]) => {
      // a drawing out of the page has no width, which is not a width to draw at
      if (entry.contentRect.width > 0) plotWidth.value = Math.max(120, entry.contentRect.width);
    });
    observer.observe(element);
  },
  { flush: 'post' }
);

onBeforeUnmount(() => observer?.disconnect());

/**
 * Room above the axis and below it: the curve and, beyond it, the longest number written along an
 * ordinate on that side - written upright, a number takes height rather than width. A side nothing
 * is drawn on keeps only what the node names and the reading at the top need.
 */
const rooms = computed(() => {
  const longest = (sign: 1 | -1) =>
    Math.max(
      -1,
      ...sections.value
        .filter((s) => Math.sign(s[drawn.value]) === sign)
        .map((s) => widthOf(showBriefly(quantityOf(drawn.value).convert(s[drawn.value]), drawn.value), LABEL_SIZE))
    );
  const side = (sign: 1 | -1) => {
    const text = longest(sign);
    return text < 0 ? 34 * em : Math.max(34 * em, REACH + GAP + 3 * em + text + 4 * em);
  };

  return { above: Math.round(side(-1)), below: Math.round(side(1)) };
});

const plotHeight = computed(() => rooms.value.above + rooms.value.below);

/** Where the axis sits and how far the diagram may reach either side of it. */
const axis = computed(() => ({
  y: rooms.value.above,
  reach: REACH,
  left: PAD_X,
  right: Math.max(PAD_X + 20, plotWidth.value - PAD_X),
}));

const atX = (x: number) =>
  axis.value.left + (axis.value.right - axis.value.left) * (length.value ? x / length.value : 0);

/**
 * The curve, sampled far more finely than the table is: the table is a set of readings, the diagram
 * is the shape between them, and tying the two together would make a parabola look like a chain of
 * chords whenever few sections were asked for.
 */
const curve = computed(() =>
  solved.value ? chainResultsAlong(chain.value!, loadCase.value, 100 * (chain.value?.parts.length ?? 1)) : []
);

const scale = computed(() => {
  const peak = curve.value.reduce((max, section) => Math.max(max, Math.abs(section[drawn.value])), 0);

  return peak ? axis.value.reach / peak : 0;
});

const atY = (value: number) => axis.value.y + value * scale.value;

const outline = computed(() => curve.value.map((s) => `${atX(s.x)},${atY(s[drawn.value])}`).join(' '));

const filled = computed(() => {
  if (!curve.value.length) return '';

  return `${atX(0)},${axis.value.y} ${outline.value} ${atX(length.value)},${axis.value.y}`;
});

/** The sections the table lists, marked on the diagram - as if each were a node of its own. */
const marks = computed(() =>
  sections.value.map((section) => ({
    x: atX(section.x),
    at: section.x,
    y: atY(section[drawn.value]),
    value: section[drawn.value],
    side: section.side,
    text: showBriefly(quantityOf(drawn.value).convert(section[drawn.value]), drawn.value),
  }))
);

/**
 * Where the drawn quantity turns, solved against its own slope rather than read off the table.
 *
 * The peak of a moment almost never falls on a regular division, and it is usually the one place on
 * the beam anyone wants a number from. Marking it is only half of it - the pointer stops there too,
 * so the exact value can be read in the row above.
 */
const turns = computed(() => (solved.value ? chainStationaryPoints(chain.value!, loadCase.value, drawn.value) : []));

const turningMarks = computed(() =>
  turns.value.map((x) => {
    const section = chainResultsAt(chain.value!, loadCase.value, x);

    return {
      x: atX(x),
      y: atY(section[drawn.value]),
      value: section[drawn.value],
      text: showBriefly(quantityOf(drawn.value).convert(section[drawn.value]), drawn.value),
    };
  })
);

/**
 * Where the quantity on show steps, which is not everywhere a section is read either side.
 *
 * A prescribed deformation steps the deflection and leaves the internal forces whole, so on a
 * moment diagram its distance is an ordinary place on the beam - and writing two numbers there,
 * ahead of everything else and at the cost of a neighbour, says a jump is there when none is.
 */
const stepsHere = (at: number) =>
  solved.value && chainJumpsOf(chain.value!, loadCase.value, drawn.value).some((jump) => Math.abs(jump - at) < 1e-6);

/**
 * Everything written on the diagram, in the order it earns its place.
 *
 * A value at a jump is the point of a jump - the shear before a load and after it are two different
 * readings and both are wanted - so those are written before anything else, then a peak, and only
 * the regular sections give way. The two of a pair are set apart left and right of the ordinate and one
 * above the curve, one below, so neither has to be dropped for the other.
 *
 * What is dropped is whatever would be written on top of something already there. Nine numbers
 * across a diagram sit about sixty pixels apart and are forty wide, so they only collide near a
 * jump or a peak - which is exactly where the numbers that matter are.
 */
/**
 * A number written upright beside an ordinate, reading upwards: anchored at `y`, it runs down from
 * there (`end`) for a value drawn below the axis and up (`start`) for one drawn above it, so it
 * always reads away from the curve. Upright, the numbers of neighbouring sections stand side by
 * side a line apart rather than needing their whole length between them.
 */
interface DiagramLabel {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  text: string;
  kind: 'turn' | 'jump' | 'ordinate';
}

/** The box a label takes: a line of text across, its length along the ordinate. */
const box = (label: DiagramLabel) => {
  const length = widthOf(label.text, LABEL_SIZE);
  const half = LABEL_SIZE / 2;

  return {
    across: [label.x - half, label.x + half] as const,
    along: (label.anchor === 'end' ? [label.y, label.y + length] : [label.y - length, label.y]) as readonly [
      number,
      number,
    ],
  };
};

/**
 * The same label, nudged back inside the drawing: the section at either end sits against the edge,
 * and half a line of text there hangs off the side.
 */
const fitted = (label: DiagramLabel): DiagramLabel => {
  const [from, to] = box(label).across;
  const over = Math.max(0, to - (plotWidth.value - 1)) - Math.max(0, 1 - from);

  return over === 0 ? label : { ...label, x: label.x - over };
};

const clashes = (a: DiagramLabel, b: DiagramLabel) => {
  const one = box(a);
  const other = box(b);
  const overlap = (p: readonly [number, number], q: readonly [number, number], gap: number) =>
    p[0] < q[1] + gap && q[0] < p[1] + gap;

  return overlap(one.across, other.across, em) && overlap(one.along, other.along, 2 * em);
};

/** Away from the axis, the way a value is drawn: down for a positive one, up for a negative one. */
const outward = (value: number) => (value >= 0 ? 1 : -1);

const labels = computed<DiagramLabel[]>(() => {
  const wanted: DiagramLabel[] = [];

  for (const mark of marks.value) {
    if (mark.side && stepsHere(mark.at)) {
      // the two of a pair stand either side of the ordinate, a line of text apart
      wanted.push({
        x: mark.x + mark.side * (LABEL_SIZE / 2 + em),
        y: mark.y + outward(mark.value) * GAP,
        anchor: mark.value >= 0 ? 'end' : 'start',
        text: mark.text,
        kind: 'jump',
      });
    }
  }

  for (const mark of turningMarks.value) {
    // past the ring that marks it
    wanted.push({
      x: mark.x,
      y: mark.y + outward(mark.value) * (GAP + 3 * em),
      anchor: mark.value >= 0 ? 'end' : 'start',
      text: mark.text,
      kind: 'turn',
    });
  }

  // every section asks for its number; where they are too close, every other one or so is kept
  for (const mark of marks.value) {
    // a pair that does step here is already written, as two numbers rather than one
    if (mark.side === -1 && stepsHere(mark.at)) continue;
    // and where it does not step, the two carry the same number: one of them says it
    if (mark.side === 1) continue;

    wanted.push({
      x: mark.x,
      y: mark.y + outward(mark.value) * GAP,
      anchor: mark.value >= 0 ? 'end' : 'start',
      text: mark.text,
      kind: 'ordinate',
    });
  }

  const kept: DiagramLabel[] = [];

  for (const label of wanted) {
    const placed = fitted(label);

    if (kept.some((already) => clashes(already, placed))) continue;

    kept.push(placed);
  }

  return kept;
});

/**
 * How near the pointer has to come to a section for it to be taken as meant.
 *
 * Half a step is right for a grid the reader can aim at, but the peak of a moment is not on any
 * grid: at a centimetre step that would be about one pixel wide, so the one place on the beam worth
 * stopping at would be the hardest to hit. Magnetism is a matter of pointing, so its reach is set
 * in pointing terms - a few pixels of the diagram - and the step only governs the space between.
 */
const reach = computed(() => {
  const perPixel = length.value ? length.value / (axis.value.right - axis.value.left) : 0;

  return Math.max(stepInMetres.value / 2, perPixel * 4);
});

/**
 * The nearest section the pointer is allowed to stop on.
 *
 * A step alone cannot always reach what a reader is after - an eighth of a three metre beam is
 * 37.5 cm, which no whole centimetre lands on, and a moment peaks wherever the shear happens to
 * cross zero. Those, with the two ends, are exactly the places someone points at, so they pull the
 * pointer onto them; everywhere else it is the step.
 *
 * Only the pointer is held to this. A distance typed into the field is taken as it is written.
 */
const snap = (metres: number) => {
  const at = Math.min(Math.max(metres, 0), length.value);
  const size = stepInMetres.value;

  if (!(size > 0)) return at;

  // the sections the table lists, the two ends, and wherever the drawn quantity turns
  const nearest = [...sections.value.map((section) => section.x), ...turns.value].reduce(
    (best, candidate) => (Math.abs(candidate - at) < Math.abs(best - at) ? candidate : best),
    Infinity
  );

  if (Math.abs(nearest - at) <= reach.value) return nearest;

  // a step of 0.01 gives 0.37000000000000005 at the thirty-seventh of them
  return Number(Math.min(Math.max(Math.round(at / size) * size, 0), length.value).toPrecision(12));
};

const track = (event: PointerEvent) => {
  const box = plot.value?.getBoundingClientRect();

  if (!box || !solved.value) return;

  const along = ((event.clientX - box.left - axis.value.left) / (axis.value.right - axis.value.left)) * length.value;

  position.value = Number(appStore.convertLength(snap(along)).toPrecision(12));
};

/** Everything on show, tab separated, so it can go straight into a spreadsheet. */
const copy = () => {
  const header = ['x', ...quantities.value.map((q) => q.name)].join('\t');
  const line = (section: SectionResult) =>
    [appStore.convertLength(section.x), ...quantities.value.map((q) => q.convert(section[q.key]))].join('\t');

  navigator.clipboard?.writeText([header, ...sections.value.map(line)].join('\n'));
};
</script>

<template>
  <div class="fill-height d-flex flex-column">
    <template v-if="usable">
      <div class="d-flex align-center ga-3 pa-2 flex-grow-0 border-b">
        <v-text-field
          v-model.number="divisions"
          type="number"
          min="1"
          max="200"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 110px"
          :label="$t('common.divisions')"
        />
        <!--
          A section asked for is the other half of the question: not "what does it do along its
          length" but "what does it carry here". It is solved at that distance rather than read off
          the table, so it does not depend on the division count landing on it.
        -->
        <v-text-field
          v-model.number="position"
          type="number"
          :min="0"
          :max="appStore.convertLength(length)"
          :step="step"
          density="compact"
          variant="outlined"
          hide-details
          clearable
          style="max-width: 150px"
          :label="`${$t('common.atPosition')} [${appStore.units.Length}]`"
        />
        <v-text-field
          v-model.number="step"
          type="number"
          :min="0"
          density="compact"
          variant="outlined"
          hide-details
          style="max-width: 110px"
          :label="$t('common.step')"
        />
        <span class="text-caption text-medium-emphasis"
          >L = {{ showLength(appStore.convertLength(length)) }} {{ appStore.units.Length }}</span
        >
        <!-- offered only where there is a run to read: the element carries on in line at a joint -->
        <v-checkbox-btn
          v-if="run.length > 1"
          v-model="whole"
          density="compact"
          hide-details
          class="flex-grow-0"
          :label="`${$t('common.wholeBeam')} (${run.length})`"
        />
        <v-chip v-if="appStore.workspace === 'influence'" size="x-small" color="primary" label>
          {{ $t('tabView.influence') }}
        </v-chip>
        <v-btn
          icon="mdi-content-copy"
          size="small"
          density="comfortable"
          variant="text"
          class="ml-auto"
          :title="$t('common.copy')"
          @click="copy"
        />
      </div>

      <div class="flex-grow-1 pa-2" style="overflow: auto">
        <div v-if="!solved" class="text-caption text-medium-emphasis">{{ $t('common.notSolved') }}</div>

        <template v-else>
          <div class="d-flex align-center ga-2 mb-1">
            <v-btn-toggle v-model="drawn" density="compact" variant="outlined" divided mandatory>
              <v-btn v-for="q in quantities" :key="q.key" :value="q.key" size="x-small" class="text-none px-3">
                {{ q.name }}
              </v-btn>
            </v-btn-toggle>
            <span class="text-caption text-medium-emphasis">[{{ quantityOf(drawn).unit }}]</span>
            <span class="text-caption text-medium-emphasis ml-auto">{{ $t('common.pointAlongHint') }}</span>
          </div>

          <svg
            ref="plot"
            class="d-block mb-2"
            :viewBox="`0 0 ${plotWidth} ${plotHeight}`"
            :height="plotHeight"
            style="width: 100%; touch-action: none; cursor: crosshair"
            @pointermove="track"
            @pointerdown="track"
          >
            <polygon :points="filled" fill="rgba(25, 118, 210, 0.14)" />
            <polyline :points="outline" fill="none" stroke="#1976d2" stroke-width="1.5" />

            <!-- an ordinate at every section the table lists, as if each were a node of its own -->
            <g v-for="(mark, i) in marks" :key="i">
              <line :x1="mark.x" :y1="axis.y" :x2="mark.x" :y2="mark.y" stroke="#1976d2" stroke-width="0.75" />
              <circle class="ordinate" :cx="mark.x" :cy="mark.y" :r="1.8 * em" fill="#1976d2" />
            </g>

            <!-- every number the diagram has room for, the ones at a jump and a peak first -->
            <text
              v-for="(written, i) in labels"
              :key="`label-${i}`"
              :class="written.kind"
              :x="written.x"
              :y="written.y"
              :text-anchor="written.anchor"
              :transform="`rotate(-90 ${written.x} ${written.y})`"
              dy="0.35em"
              :font-size="LABEL_SIZE"
              :font-weight="written.kind === 'turn' ? 600 : 400"
              :fill="written.kind === 'turn' ? '#ef6c00' : '#1976d2'"
            >
              {{ written.text }}
            </text>

            <!-- where the quantity turns: solved for, so it need not be one of the sections above -->
            <g v-for="(mark, i) in turningMarks" :key="`turn-${i}`">
              <line
                :x1="mark.x"
                :y1="axis.y"
                :x2="mark.x"
                :y2="mark.y"
                stroke="#ef6c00"
                stroke-width="1"
                stroke-dasharray="2 2"
              />
              <circle
                class="turn"
                :cx="mark.x"
                :cy="mark.y"
                :r="3 * em"
                fill="#ffffff"
                stroke="#ef6c00"
                stroke-width="1.5"
              />
            </g>

            <!-- the element itself, drawn straight whatever its angle, with a named node at each end
                 and at every joint of a run -->
            <line :x1="atX(0)" :y1="axis.y" :x2="atX(length)" :y2="axis.y" stroke="#000000" stroke-width="1.5" />
            <g v-for="node in ends" :key="node.label">
              <rect
                :x="atX(node.x) - 3 * em"
                :y="axis.y - 3 * em"
                :width="6 * em"
                :height="6 * em"
                fill="#ffffff"
                stroke="#000000"
              />
              <circle
                class="node"
                :cx="atX(node.x)"
                :cy="axis.y - 14 * em"
                :r="ringAround(node.label)"
                fill="#ffffff"
                stroke="#000000"
              />
              <text
                class="node"
                :x="atX(node.x)"
                :y="axis.y - 14 * em"
                text-anchor="middle"
                dominant-baseline="central"
                :font-size="LABEL_SIZE"
                fill="#000000"
              >
                {{ node.label }}
              </text>
            </g>

            <g v-if="asked">
              <line
                :x1="atX(asked.x)"
                y1="4"
                :x2="atX(asked.x)"
                :y2="plotHeight - 4"
                stroke="#d81b60"
                stroke-width="1"
                stroke-dasharray="3 2"
              />
              <circle :cx="atX(asked.x)" :cy="atY(asked[drawn])" :r="2.6 * em" fill="#d81b60" />
              <text :x="atX(asked.x)" :y="11 * em" text-anchor="middle" :font-size="LABEL_SIZE" fill="#d81b60">
                {{ showBriefly(quantityOf(drawn).convert(asked[drawn]), drawn) }}
              </text>
            </g>
          </svg>
        </template>

        <v-table v-if="solved" class="border text-right" density="compact" style="white-space: nowrap">
          <thead>
            <tr>
              <th class="text-right px-2 font-weight-regular">
                x<span class="text-medium-emphasis"> [{{ appStore.units.Length }}]</span>
              </th>
              <th v-for="q in quantities" :key="q.key" class="text-right px-2 font-weight-regular">
                {{ q.name }}<span class="text-medium-emphasis"> [{{ q.unit }}]</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <!-- The section asked for sits above the regular ones, marked, in the same columns. -->
            <tr v-if="asked" class="asked">
              <th class="text-right px-2 font-weight-regular">
                <v-icon size="12" icon="mdi-arrow-right-thin" class="mr-1" />{{
                  showLength(appStore.convertLength(asked.x))
                }}
              </th>
              <td v-for="q in quantities" :key="q.key" class="px-2">{{ show(q.convert(asked[q.key]), q.key) }}</td>
            </tr>
            <tr v-for="(section, i) in sections" :key="i">
              <th class="text-right px-2 text-medium-emphasis font-weight-regular">
                {{ showLength(appStore.convertLength(section.x))
                }}<sup v-if="section.side">{{ section.side === -1 ? '−' : '+' }}</sup>
              </th>
              <td
                v-for="q in quantities"
                :key="q.key"
                class="px-2 value"
                :class="{ 'font-weight-bold': extremes[q.key] === i }"
              >
                {{ show(q.convert(section[q.key]), q.key) }}
                <span class="bar" :style="bar(section, q.key)" />
              </td>
            </tr>
          </tbody>
        </v-table>

        <div v-if="solved" class="text-caption text-medium-emphasis mt-2">{{ $t('common.extremeShownHint') }}</div>
      </div>
    </template>

    <div v-else class="pa-3">Element does not specify material or cross section.</div>
  </div>
</template>

<style scoped>
/* The table is a child component's, so every rule for it has to reach past the scope. */
:deep(table td + td),
:deep(table th + td),
:deep(thead th + th) {
  border-left: 1px solid #dddddd;
}

/*
 * Columns of a fixed width, so they do not resize as the numbers in them change.
 *
 * A table sized to its content re-measures every time a value does: pointing along the beam rewrites
 * the pinned row several times a second, and each rewrite nudged every column. The numbers are all
 * of one kind and one width is enough for them, so the width is settled once and the table scrolls
 * inside the widget when the widget is too narrow for it.
 */
:deep(table) {
  table-layout: fixed;
  width: max-content;
  min-width: 100%;
}

:deep(thead th) {
  width: 106px;
  min-width: 106px;
}

:deep(thead th:first-child) {
  width: 78px;
  min-width: 78px;
}

/* Room under the number for the bar, which is laid over the row's own background rather than in it. */
.value {
  position: relative;
  padding-bottom: 5px !important;
}

.bar {
  position: absolute;
  bottom: 2px;
  height: 2px;
  background: #1976d2;
  opacity: 0.55;
}

.asked td,
.asked th {
  background: #e3f2fd !important;
}
</style>
