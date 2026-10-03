/**
 * Arrows and moment arcs for a free body diagram, in the widget's own drawing units.
 *
 * The drawing is the model's own picture, y down being z down, so a force goes on screen exactly
 * as the solver has it. Sizes here are fixed and do not depend on the structure's.
 */
export interface Vec {
  x: number;
  y: number;
}

export interface Arrow {
  /** The shaft, from the tail to where the head begins. */
  from: Vec;
  to: Vec;
  /** The point of the head. */
  tip: Vec;
  /** The head, as polygon points. */
  head: string;
  /** Where a label goes: just past the end of the arrow away from the point it acts at. */
  label: Label;
}

export interface Label extends Vec {
  anchor: 'start' | 'middle' | 'end';
}

const HEAD = 9;
const HALF_WIDTH = 4;

/** Shortest arrow drawn for a force that is not nothing, and how much longer the largest gets. */
const MIN_LENGTH = 18;
const SPAN = 62;

const add = (a: Vec, b: Vec, k = 1): Vec => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/**
 * How long to draw a force, against the largest one in the same diagram; zero for one too small
 * to be anything but rounding.
 */
export const forceLength = (value: number, largest: number) => {
  const size = Math.abs(value);
  if (largest <= 0 || size <= largest * 1e-9) return 0;

  return MIN_LENGTH + (SPAN * size) / largest;
};

const head = (tip: Vec, along: Vec) => {
  const base = add(tip, along, -HEAD);
  const left = { x: base.x - along.y * HALF_WIDTH, y: base.y + along.x * HALF_WIDTH };
  const right = { x: base.x + along.y * HALF_WIDTH, y: base.y - along.x * HALF_WIDTH };

  return { base, points: `${tip.x},${tip.y} ${left.x},${left.y} ${right.x},${right.y}` };
};

/** Text beside a point, on the side a direction points to, anchored so it grows away from it. */
export const labelBeyond = (point: Vec, direction: Vec, gap = 6): Label => {
  const at = add(point, direction, gap);
  const anchor = direction.x > 0.35 ? 'start' : direction.x < -0.35 ? 'end' : 'middle';
  // text sits on its baseline: one going down drops a line, one going sideways centres on it
  const y = direction.y > 0.35 ? at.y + 10 : Math.abs(direction.y) <= 0.35 ? at.y + 4 : at.y;

  return { x: at.x, y, anchor };
};

/**
 * A force at a point. Arriving, its head touches the point and its tail stands off; leaving, it
 * starts at the point. Either way `direction` is the way the force acts, as a unit vector.
 */
export const forceArrow = (at: Vec, direction: Vec, length: number, arriving: boolean): Arrow => {
  const tail = arriving ? add(at, direction, -length) : at;
  const tip = arriving ? at : add(at, direction, length);
  const { base, points } = head(tip, direction);
  const outer = arriving ? tail : tip;
  const away = arriving ? { x: -direction.x, y: -direction.y } : direction;

  return { from: tail, to: base, tip, head: points, label: labelBeyond(outer, away) };
};

export interface Arc {
  path: string;
  head: string;
  label: Label;
}

/**
 * A moment as two thirds of a circle around a point, open on the side `facing` points away from,
 * turning counter-clockwise on screen for a positive one - the way the drawing shows a moment.
 */
export const momentArc = (center: Vec, radius: number, positive: boolean, facing: Vec): Arc => {
  const middle = Math.atan2(facing.y, facing.x);
  const half = (2 * Math.PI) / 3;
  // screen angles grow clockwise, y being down: counter-clockwise runs them backwards
  const start = positive ? middle + half : middle - half;
  const end = positive ? middle - half : middle + half;
  const point = (angle: number) => ({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) });

  const from = point(start);
  const to = point(end);
  const sweep = positive ? 0 : 1;
  const tangent = positive ? { x: Math.sin(end), y: -Math.cos(end) } : { x: -Math.sin(end), y: Math.cos(end) };

  return {
    path: `M ${from.x} ${from.y} A ${radius} ${radius} 0 1 ${sweep} ${to.x} ${to.y}`,
    head: head(to, tangent).points,
    label: labelBeyond(point(middle), { x: Math.cos(middle), y: Math.sin(middle) }),
  };
};

export const unit = (v: Vec): Vec => {
  const length = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / length, y: v.y / length };
};

/**
 * Of sixteen directions around a point, the one furthest from every direction already taken there:
 * where a moment's label can go without landing on an element or an arrow.
 */
export const freeDirection = (taken: Vec[], fallback: Vec = { x: 0, y: -1 }): Vec => {
  if (taken.length === 0) return fallback;

  let best = fallback;
  let widest = -1;

  for (let k = 0; k < 16; k++) {
    const angle = (k * Math.PI) / 8;
    const candidate = { x: Math.cos(angle), y: Math.sin(angle) };
    const gap = Math.min(
      ...taken.map((t) => Math.acos(Math.max(-1, Math.min(1, candidate.x * t.x + candidate.y * t.y))))
    );

    if (gap > widest + 1e-9) {
      widest = gap;
      best = candidate;
    }
  }

  return best;
};

/** The corners of a label's text, roughly: wide enough for its characters at the drawing's size. */
export const textCorners = (label: Label, text: string, size = 12): Vec[] => {
  const width = text.length * size * 0.55;
  const left = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - width : label.x - width / 2;

  return [
    { x: left, y: label.y - size },
    { x: left + width, y: label.y + 3 },
  ];
};

/**
 * A viewBox that holds every point given, with a margin. It does not shrink below a minimum, so a
 * diagram with almost nothing in it is not blown up to fill the widget.
 */
export const viewBoxAround = (points: Vec[], margin = 14, minWidth = 220, minHeight = 160) => {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const width = Math.max(minWidth, Math.max(...xs) - Math.min(...xs) + 2 * margin);
  const height = Math.max(minHeight, Math.max(...ys) - Math.min(...ys) + 2 * margin);

  return `${cx - width / 2} ${cy - height / 2} ${width} ${height}`;
};
