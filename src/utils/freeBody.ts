import {
  Beam2D,
  BeamConcentratedLoad,
  BeamElementTrapezoidalEdgeLoad,
  BeamElementUniformEdgeLoad,
  DofID,
  type LoadCase,
  type Solver,
} from 'ts-fem';
import { endForcesLocal } from './elementMatrices';

/**
 * A free body: an element cut out of the structure with what holds it at its ends and what is put
 * on it, or a node with what every element meeting there and its support do to it.
 *
 * Forces are in SI and in the solver's own axes - x to the right, z down - and a moment is positive
 * counter-clockwise on screen, which is how the drawing turns one. The end forces are the ones the
 * end forces tab lists; nothing here is worked out again.
 */
export type FreeBodySystem = 'local' | 'global';

export interface PointForce {
  fx: number;
  fz: number;
  m: number;
}

/** A matrix from mathjs as plain rows. */
const rows = (value: unknown): number[][] => {
  const v = value as { toArray?: () => unknown };
  const array = typeof v?.toArray === 'function' ? v.toArray() : value;

  return Array.isArray(array) ? array.map((row) => (Array.isArray(row) ? row.map(Number) : [Number(row)])) : [];
};

const flat = (value: unknown): number[] => rows(value).flat();

/** A load switched off takes no part in the solution, so it takes no part here either. */
const isActive = (load: object) => Reflect.get(load, 'active') !== false;

/** The element's own axis and its normal, as unit vectors in the solver's x and z. */
export const elementAxes = (element: Beam2D) => {
  const { dx, dz, l } = element.computeGeo();
  const c = dx / l;
  const s = dz / l;

  return { along: { x: c, z: s }, normal: { x: -s, z: c } };
};

/** A pair in the element's own axes turned into the global ones. */
const toGlobal = (element: Beam2D, { fx, fz }: { fx: number; fz: number }) => {
  const { along, normal } = elementAxes(element);

  return { fx: fx * along.x + fz * normal.x, fz: fx * along.z + fz * normal.z };
};

/**
 * What each node does to the element at its two ends: the total of the end forces tab.
 *
 * The global pair is the local one turned by the element's own direction. The tab's global vector
 * goes through the transformation matrix instead, which also turns an end into its node's own
 * system when the node sits on a rotated support; the drawing wants x and z there too.
 */
export const elementEndForces = (element: Beam2D, loadCase: LoadCase, system: FreeBodySystem) => {
  const total = endForcesLocal(element, loadCase).total.map((row) => row[0]);
  const ends: [PointForce, PointForce] = [
    { fx: total[0], fz: total[1], m: total[2] },
    { fx: total[3], fz: total[4], m: total[5] },
  ];

  return system === 'local'
    ? ends
    : (ends.map((f) => ({ ...toGlobal(element, f), m: f.m })) as [PointForce, PointForce]);
};

/** Whether the element has a release at each of its ends. */
export const elementHinges = (element: Beam2D): [boolean, boolean] => [
  element.hinges?.[0] === true,
  element.hinges?.[1] === true,
];

interface Intensity {
  fx: number;
  fz: number;
}

/** A load on an element as the drawing needs it: where it sits, in metres from the first node. */
export type ElementLoadShape =
  | { kind: 'distributed'; from: number; to: number; start: Intensity; end: Intensity }
  | { kind: 'point'; at: number; fx: number; fz: number; m: number };

/**
 * The loads on an element, split into components along its own axes or the global ones - the split
 * ts-fem makes itself. A temperature load and an imposed deformation push nothing along or across
 * the element and are left out.
 */
export const elementLoadShapes = (element: Beam2D, loadCase: LoadCase, system: FreeBodySystem): ElementLoadShape[] => {
  const l = element.computeGeo().l;
  const clamp = (x: number) => Math.min(Math.max(x, 0), l);

  return loadCase.getElementLoadsOnElement(element.label).flatMap((load): ElementLoadShape[] => {
    if (!isActive(load)) return [];

    if (load instanceof BeamElementUniformEdgeLoad) {
      const q = system === 'local' ? load.getLocalIntensities() : load.getGlobalIntensities();
      const intensity = { fx: q.fx, fz: q.fz };

      return [{ kind: 'distributed', from: 0, to: l, start: intensity, end: intensity }];
    }

    if (load instanceof BeamElementTrapezoidalEdgeLoad) {
      const q = system === 'local' ? load.getLocalIntensities() : load.getGlobalIntensities();
      // a load given back to front is the same load, and ts-fem reads it so
      const a = clamp(load.from ?? 0);
      const b = clamp(load.to ?? l);

      return a <= b
        ? [{ kind: 'distributed', from: a, to: b, start: q.start, end: q.end }]
        : [{ kind: 'distributed', from: b, to: a, start: q.end, end: q.start }];
    }

    if (load instanceof BeamConcentratedLoad) {
      const q = system === 'local' ? load.getLocalIntensities() : load.getGlobalIntensities();

      return [{ kind: 'point', at: clamp(load.values[3]), fx: q.fx, fz: q.fz, m: q.my }];
    }

    return [];
  });
};

export interface NodeContribution extends PointForce {
  kind: 'element' | 'load' | 'reaction';
  /** The element's label, for an element. */
  label?: string;
}

const byDof = (dofs: DofID[], values: number[]): PointForce => {
  const at = (dof: DofID) => {
    const i = dofs.indexOf(dof);
    return i < 0 ? 0 : (values[i] ?? 0);
  };

  return { fx: at(DofID.Dx), fz: at(DofID.Dz), m: at(DofID.Ry) };
};

/**
 * Every force on one node, in the global system: what each element meeting there pushes back with,
 * the nodal loads put on it, and what its support holds it with. On a solved structure they add up
 * to nothing, which is the point of showing them.
 *
 * The node pushes on an element with that element's end force, so the element pushes back with the
 * opposite.
 */
export const nodeEquilibrium = (solver: Solver, nodeLabel: string, loadCase: LoadCase) => {
  const node = solver.domain.nodes.get(nodeLabel);
  const contributions: NodeContribution[] = [];

  if (!node) return { contributions, sum: { fx: 0, fz: 0, m: 0 } };

  for (const element of solver.domain.elements.values()) {
    if (!(element instanceof Beam2D)) continue;

    const end = element.nodes.findIndex((label) => String(label) === nodeLabel);
    if (end < 0) continue;

    const onElement = elementEndForces(element, loadCase, 'global')[end];
    contributions.push({
      kind: 'element',
      label: String(element.label),
      fx: -onElement.fx,
      fz: -onElement.fz,
      m: -onElement.m,
    });
  }

  const dofs = solver.getNodeDofIDs(nodeLabel);

  for (const load of loadCase.nodalLoadList) {
    if (String(load.target) !== nodeLabel || !isActive(load)) continue;

    let values = dofs.map((dof) => load.values[dof] ?? 0);

    // A node on a rotated support takes its loads in its own system, as its support reports its
    // reactions; the matrix ts-fem turns a reaction global with turns the load global.
    if (node.hasLcs()) {
      const local = values;
      values = rows(node.getTransformationMtrx(dofs)).map((row) =>
        row.reduce((total, factor, j) => total + factor * (local[j] ?? 0), 0)
      );
    }

    contributions.push({ kind: 'load', ...byDof(dofs, values) });
  }

  if (node.bcs.size > 0) {
    const reactions = node.getReactions(loadCase, true);
    contributions.push({ kind: 'reaction', ...byDof(reactions.dofs, flat(reactions.values)) });
  }

  const sum = contributions.reduce((total, c) => ({ fx: total.fx + c.fx, fz: total.fz + c.fz, m: total.m + c.m }), {
    fx: 0,
    fz: 0,
    m: 0,
  });

  return { contributions, sum };
};
