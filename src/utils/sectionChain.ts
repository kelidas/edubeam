import { Beam2D, type LoadCase, type Solver } from 'ts-fem';
import {
  EITHER_SIDE,
  elementLength,
  jumpsOf,
  resultsAt,
  stationaryPoints,
  type SectionQuantity,
  type SectionResult,
} from './sectionResults';

/**
 * Several elements in one straight line, read as one beam: a continuous beam modelled span by span.
 *
 * Each element keeps its own results - everything still comes from ts-fem one element at a time -
 * and the chain only lays them end to end, with `x` measured from the chain's first node. An
 * element modelled the other way round has its own axis pointing back along the chain, so its
 * results are turned to the chain's: see `alongChain`.
 */
export interface ChainPart {
  element: Beam2D;
  /** Whether the element runs against the chain: its first node is the one further along. */
  reversed: boolean;
  /** Where the element starts along the chain. */
  offset: number;
  length: number;
}

export interface Chain {
  parts: ChainPart[];
  length: number;
  /** The nodes in order along the chain, with where each sits. */
  nodes: { label: string; x: number }[];
}

const QUANTITIES: SectionQuantity[] = ['n', 'vz', 'my', 'u', 'w', 'phi'];

/** Two directions on one line, either way round. */
const parallel = (a: Beam2D, b: Beam2D) => {
  const ga = a.computeGeo();
  const gb = b.computeGeo();

  return Math.abs(ga.dx * gb.dz - ga.dz * gb.dx) <= 1e-9 * ga.l * gb.l;
};

/**
 * The elements given, put in order along one straight line, or null if they are not one.
 *
 * They have to join end to end without a gap or a branch, and lie on the same line. The chain runs
 * the way `keep` points, if it is one of them - so the element a reader started from reads as it
 * did on its own - and otherwise the way x grows, left to right, which is how anyone reads a
 * continuous beam (down, for a vertical one). An element pointing the other way is marked reversed.
 */
export const chainOf = (elements: Beam2D[], keep?: Beam2D): Chain | null => {
  if (elements.length === 0) return null;
  if (elements.some((e) => !parallel(e, elements[0]))) return null;

  // how many of the given elements meet at each node: a chain has two ends and nothing branching
  const meeting = new Map<string, Beam2D[]>();
  for (const e of elements) for (const n of e.nodes.map(String)) meeting.set(n, [...(meeting.get(n) ?? []), e]);

  if ([...meeting.values()].some((at) => at.length > 2)) return null;

  const ends = [...meeting].filter(([, at]) => at.length === 1).map(([n]) => n);
  if (ends.length !== 2) return null;

  // start at the end the chain grows away from in x (or z for a vertical line)
  const domain = elements[0].domain;
  const coord = (n: string) => domain.nodes.get(n)!.coords;
  const { dx } = elements[0].computeGeo();
  const key = (n: string) => (Math.abs(dx) > 1e-12 ? coord(n)[0] : coord(n)[2]);
  const leftmost = key(ends[0]) <= key(ends[1]) ? ends[0] : ends[1];
  const built = walk(elements, meeting, leftmost);

  if (!built || !keep || !elements.includes(keep)) return built;
  if (!built.parts.find((p) => p.element === keep)!.reversed) return built;

  return walk(
    elements,
    meeting,
    ends.find((n) => n !== leftmost)!
  );
};

/** The chain laid out from one of its two end nodes. */
const walk = (elements: Beam2D[], meeting: Map<string, Beam2D[]>, from: string): Chain | null => {
  let node = from;
  const parts: ChainPart[] = [];
  const nodes = [{ label: node, x: 0 }];
  const used = new Set<Beam2D>();
  let offset = 0;

  while (parts.length < elements.length) {
    const next = (meeting.get(node) ?? []).find((e) => !used.has(e));
    if (!next) return null;

    used.add(next);
    const reversed = String(next.nodes[0]) !== node;
    const length = elementLength(next);
    parts.push({ element: next, reversed, offset, length });

    offset += length;
    node = String(next.nodes[reversed ? 0 : 1]);
    nodes.push({ label: node, x: offset });
  }

  return { parts, length: offset, nodes };
};

/**
 * The straight run of elements through one: every element carrying on in the same line from each
 * of its ends, as far as it goes on unambiguously. A continuous beam is found from any one of its
 * spans this way; a column meeting it at a support is not in line and is passed over.
 */
export const collinearRun = (solver: Solver, start: Beam2D): Beam2D[] => {
  const elements = [...solver.domain.elements.values()].filter((e): e is Beam2D => e instanceof Beam2D);
  const run = [start];

  for (const from of start.nodes.map(String)) {
    let node = from;
    let current = start;

    for (;;) {
      const onward = elements.filter(
        (e) => e !== current && !run.includes(e) && e.nodes.map(String).includes(node) && parallel(e, start)
      );
      if (onward.length !== 1) break;

      current = onward[0];
      run.push(current);
      node = String(current.nodes.map(String).find((n) => n !== node));
    }
  }

  return run;
};

/**
 * A section of an element read along the chain.
 *
 * Turned round, an element's axis points back along the chain and so does the side its z points
 * to: its axial displacement and its deflection come out with the opposite sign, and so does its
 * moment, whose sagging side is the other side of the beam. The normal force and the shear do not
 * change - the shear is the moment's slope, and both the moment and the distance it is taken over
 * turn - and nor does the rotation, about an axis that both turns leave where it was.
 */
const alongChain = (part: ChainPart, section: SectionResult, x: number): SectionResult => {
  const turned = part.reversed ? { ...section, my: -section.my, u: -section.u, w: -section.w } : section;

  return { ...turned, x };
};

/** Where a distance along the chain falls on an element, and that element's own distance for it. */
const locate = (chain: Chain, x: number, prefer: -1 | 1 = 1) => {
  const at = Math.min(Math.max(x, 0), chain.length);
  const index = chain.parts.findIndex((p) =>
    prefer === 1 ? at < p.offset + p.length || p === chain.parts.at(-1) : at <= p.offset + p.length
  );
  const part = chain.parts[Math.max(0, index)];
  const along = at - part.offset;

  return { part, own: part.reversed ? part.length - along : along };
};

/**
 * Everything at one distance along the chain. Where two elements meet, the one after the joint is
 * read unless the one before is asked for.
 */
export const chainResultsAt = (chain: Chain, loadCase: LoadCase, x: number, side: -1 | 1 = 1): SectionResult => {
  const { part, own } = locate(chain, x, side);
  const at = Math.min(Math.max(x, 0), chain.length);

  return alongChain(part, resultsAt(part.element, loadCase, own), at);
};

/** Each element's own jumps for a quantity, as distances along the chain. */
const innerJumps = (chain: Chain, loadCase: LoadCase, quantity?: SectionQuantity) =>
  chain.parts.flatMap((part) =>
    (quantity
      ? jumpsOf(part.element, loadCase, quantity)
      : QUANTITIES.flatMap((q) => jumpsOf(part.element, loadCase, q))
    ).map((x) => part.offset + (part.reversed ? part.length - x : x))
  );

/** The two sides of each joint where the elements meeting there disagree - a support, a hinge. */
const jointPairs = (chain: Chain, loadCase: LoadCase) =>
  chain.parts.slice(1).map((part) => {
    const before = chainResultsAt(chain, loadCase, part.offset, -1);
    const after = chainResultsAt(chain, loadCase, part.offset, 1);
    const steps = QUANTITIES.filter((q) => {
      const size = Math.max(Math.abs(before[q]), Math.abs(after[q]));
      return Math.abs(before[q] - after[q]) > 1e-9 * size && size > 1e-300;
    });

    return { x: part.offset, before, after, steps };
  });

/**
 * The distances where a quantity steps along the chain: inside an element at a point load, and at
 * a joint where the two elements meeting there carry different values of it.
 */
export const chainJumpsOf = (chain: Chain, loadCase: LoadCase, quantity: SectionQuantity): number[] =>
  [
    ...innerJumps(chain, loadCase, quantity),
    ...jointPairs(chain, loadCase)
      .filter((pair) => pair.steps.includes(quantity))
      .map((pair) => pair.x),
  ].sort((a, b) => a - b);

/**
 * The chain cut into equal pieces over its whole length, both ends included, with a section either
 * side of every place where something steps - inside an element, and at a joint where anything is
 * different on the two sides of it. A joint where nothing changes is an ordinary section.
 */
export const chainResultsAlong = (chain: Chain, loadCase: LoadCase, divisions: number): SectionResult[] => {
  const steps = Math.max(1, Math.floor(divisions));
  const inner = [...new Set(innerJumps(chain, loadCase))];
  const joints = jointPairs(chain, loadCase).filter((pair) => pair.steps.length > 0);
  const near = (x: number, list: number[]) => list.some((at) => Math.abs(at - x) <= EITHER_SIDE);

  const regular = Array.from({ length: steps + 1 }, (_, i) => (chain.length * i) / steps)
    .filter(
      (x) =>
        !near(x, inner) &&
        !near(
          x,
          joints.map((pair) => pair.x)
        )
    )
    .map((x) => chainResultsAt(chain, loadCase, x));

  const insideSides = inner.flatMap((jump) => [
    { ...chainResultsAt(chain, loadCase, jump - EITHER_SIDE), side: -1 as const },
    { ...chainResultsAt(chain, loadCase, jump + EITHER_SIDE), side: 1 as const },
  ]);

  const jointSides = joints.flatMap((pair) => [
    { ...pair.before, side: -1 as const },
    { ...pair.after, side: 1 as const },
  ]);

  return [...regular, ...insideSides, ...jointSides].sort((a, b) => a.x - b.x || (a.side ?? 0) - (b.side ?? 0));
};

/** Where a quantity turns inside each element, as distances along the chain. */
export const chainStationaryPoints = (chain: Chain, loadCase: LoadCase, quantity: SectionQuantity): number[] =>
  chain.parts
    .flatMap((part) =>
      stationaryPoints(part.element, loadCase, quantity).map((x) => part.offset + (part.reversed ? part.length - x : x))
    )
    .sort((a, b) => a - b);
