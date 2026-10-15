const lineProperties = (pointA, pointB) => {
  const lengthX = pointB[0] - pointA[0];
  const lengthY = pointB[1] - pointA[1];
  return {
    length: Math.sqrt(Math.pow(lengthX, 2) + Math.pow(lengthY, 2)),
    angle: Math.atan2(lengthY, lengthX),
  };
};

const controlPointCalc = (current, previous, next, reverse = false) => {
  const c = current;
  const p = previous ? previous : c;
  const n = next ? next : c;
  const smoothing = 0.2;
  const o = lineProperties(p, n);
  const rev = reverse ? Math.PI : 0;

  const x = c[0] + Math.cos(o.angle + rev) * o.length * smoothing;
  const y = c[1] + Math.sin(o.angle + rev) * o.length * smoothing;

  return [x, y];
};

/** The curves through one run of points, as path commands that carry on from its first point. */
const curvesThrough = (run: [number, number][]) =>
  run.reduce((acc, e, i, a) => {
    if (i === 0) return acc;

    const cs = controlPointCalc(a[i - 1], a[i - 2], e);
    const ce = controlPointCalc(e, a[i - 1], a[i + 1], true);

    return `${acc} C ${cs[0]},${cs[1]} ${ce[0]},${ce[1]} ${e[0]},${e[1]}`;
  }, '');

/**
 * A smooth path through the points, cut wherever `straightAfter` says: after each index listed, the
 * curve stops, a straight segment goes to the next point, and a curve of its own starts there.
 *
 * Each control point reaches a fifth of the distance between its point's neighbours, which is right
 * between points about evenly spaced and badly wrong between two a hair apart - the two either side
 * of a step - where it reaches far past both and draws a loop. Smoothed apart, neither half looks
 * across the gap.
 */
export const smoothPath = (points: [number, number][], straightAfter: number[] = []) => {
  if (points.length === 0) return '';

  const cuts = [...new Set(straightAfter)].filter((i) => i >= 0 && i < points.length - 1).sort((a, b) => a - b);
  const runs = [
    ...cuts.map((cut, k) => points.slice(k === 0 ? 0 : cuts[k - 1] + 1, cut + 1)),
    points.slice(cuts.length ? cuts.at(-1)! + 1 : 0),
  ];

  return runs.map((run, k) => `${k === 0 ? 'M' : 'L'} ${run[0][0]},${run[0][1]}${curvesThrough(run)}`).join(' ');
};
