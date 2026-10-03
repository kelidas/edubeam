import { Beam2D, DofID, type LoadCase, type Solver } from 'ts-fem';

/**
 * Forces at a point of a free body diagram, in SI and in the solver's own axes: x to the right,
 * z down, and a moment positive counter-clockwise on screen, which is how the drawing turns it.
 */
export interface PointForce {
  fx: number;
  fz: number;
  m: number;
}

/** Anything mathjs hands back, as a flat list of numbers. */
const flat = (value: unknown): number[] => {
  const v = value as { toArray?: () => unknown };
  const array = typeof v?.toArray === 'function' ? v.toArray() : value;

  return Array.isArray(array) ? array.flat(2).map(Number) : [Number(array)];
};

/** A matrix from mathjs as plain rows. */
const rows = (value: unknown): number[][] => {
  const v = value as { toArray?: () => unknown };
  const array = typeof v?.toArray === 'function' ? v.toArray() : value;

  return Array.isArray(array) ? array.map((row) => (Array.isArray(row) ? row.map(Number) : [Number(row)])) : [];
};

/** The element's own axis and its normal, as unit vectors in the solver's x and z. */
export const elementAxes = (element: Beam2D) => {
  const { dx, dz, l } = element.computeGeo();
  const c = dx / l;
  const s = dz / l;

  return { along: { x: c, z: s }, normal: { x: -s, z: c } };
};

/**
 * What each node does to the element, at both of its ends, in the element's local system and in
 * the global one.
 *
 * Read off ts-fem's `computeEndForces`, which already includes the loads on the element and any
 * release. Turning the local pair into the global one is only a rotation by the element's own
 * direction - the same one ts-fem uses for a deflection - so a node with a rotated support does not
 * leak its own system into these the way the transformation matrix would.
 */
export const elementEndForces = (element: Beam2D, loadCase: LoadCase) => {
  const f = flat(element.computeEndForces(loadCase));
  const { along, normal } = elementAxes(element);

  const local: [PointForce, PointForce] = [
    { fx: f[0], fz: f[1], m: f[2] },
    { fx: f[3], fz: f[4], m: f[5] },
  ];

  const toGlobal = ({ fx, fz, m }: PointForce): PointForce => ({
    fx: fx * along.x + fz * normal.x,
    fz: fx * along.z + fz * normal.z,
    m,
  });

  return { local, global: [toGlobal(local[0]), toGlobal(local[1])] as [PointForce, PointForce] };
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

/** A load switched off takes no part in the solution, so it takes no part here either. */
const isActive = (load: object) => Reflect.get(load, 'active') !== false;

/**
 * Every force acting on one node, in the global system: what each element meeting there pushes
 * back with, the nodal loads put on it, and what its support holds it with. They add up to zero
 * on a solved structure, which is the point of showing them.
 *
 * An element is pushed on by the node with its end force, so it pushes back with the opposite.
 */
export const nodeEquilibrium = (solver: Solver, nodeLabel: string, loadCase: LoadCase) => {
  const node = solver.domain.nodes.get(nodeLabel);
  const contributions: NodeContribution[] = [];

  if (!node) return { contributions, sum: { fx: 0, fz: 0, m: 0 } };

  for (const element of solver.domain.elements.values()) {
    if (!(element instanceof Beam2D)) continue;

    const end = element.nodes.findIndex((label) => String(label) === nodeLabel);
    if (end < 0) continue;

    const onElement = elementEndForces(element, loadCase).global[end];
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
    // reactions; the same matrix ts-fem turns a reaction global with turns the load global.
    if (node.hasLcs()) {
      const t = rows(node.getTransformationMtrx(dofs));
      const local = values;
      values = t.map((row) => row.reduce((total, factor, j) => total + factor * (local[j] ?? 0), 0));
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
