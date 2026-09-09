import * as math from 'mathjs';
import { Beam2D, DofID, type LabelType, type LoadCase, type Solver } from 'ts-fem';

/**
 * The matrices and vectors behind a solved element, for reading rather than for solving.
 *
 * Everything here comes back from ts-fem: nothing is recomputed from E, A, I and l, so a change to
 * the library's own formulation shows up here rather than quietly disagreeing with the drawing.
 *
 * Values are in SI throughout. A stiffness matrix cannot be given one unit - its entries relate a
 * force to a length in one place and a moment to a rotation in another, so there is no single
 * factor to convert it by - and mixing converted vectors with unconverted matrices would be worse
 * than leaving both alone.
 */

/** The six element degrees of freedom, in the order the matrices use. */
export const ELEMENT_DOFS = ['u₁', 'w₁', 'φ₁', 'u₂', 'w₂', 'φ₂'] as const;

/** What each degree of freedom is, in the order a node contributes them to the matrices. */
const DOF_SYMBOLS: Partial<Record<DofID, string>> = {
  [DofID.Dx]: 'u',
  [DofID.Dz]: 'w',
  [DofID.Ry]: 'φ',
};

const name = (dof: DofID, node: LabelType) => `${DOF_SYMBOLS[dof] ?? `d${dof}`} (${node})`;

/**
 * The element's six degrees of freedom named by the nodes they belong to, rather than by which end
 * of the element they are.
 *
 * `u₁` says where in the matrix a term sits but not what it is a term of, and the node is the thing
 * a reader is looking for - it is what the structure matrix and the drawing are indexed by, and
 * what makes one element's 6x6 recognisable inside the assembled one.
 */
export const elementDofNames = (element: Beam2D): string[] =>
  element.nodes.flatMap((node) => element.getNodeDofs(node).map((dof) => name(dof, node)));

/**
 * Every equation of the structure named the same way.
 *
 * The solver numbers the equations and says nothing about what they are; the mapping back is held
 * by the nodes, each of which knows which equation each of its degrees of freedom ended up as. An
 * equation no element reaches keeps its number, which is the honest thing to show for it.
 */
export const structureDofNames = (solver: Solver): string[] => {
  const names = Array.from({ length: solver.neq + solver.pneq }, (_, i) => String(i + 1));

  for (const element of solver.domain.elements.values()) {
    if (!(element instanceof Beam2D)) continue;

    for (const label of element.nodes) {
      const node = solver.domain.nodes.get(label);

      if (!node) continue;

      const dofs = element.getNodeDofs(label);

      node.getLocationArray(dofs).forEach((equation: number, i: number) => {
        if (equation >= 0 && equation < names.length) names[equation] = name(dofs[i], label);
      });
    }
  }

  return names;
};

/**
 * Which rows and columns of a matrix carry anything at all.
 *
 * Assembling from a few chosen elements leaves the rest of the structure as empty rows and columns,
 * and there can be far more of those than of the ones being looked at. Dropping them keeps what
 * remains readable; the names go with them, so the numbering still says where each row came from.
 */
export const occupied = (grid: Grid): number[] =>
  grid.map((_, i) => i).filter((i) => grid[i].some((v) => v !== 0) || grid.some((row) => row[i] !== 0));

/** A matrix reduced to those rows and columns. */
export const only = (grid: Grid, indices: number[]): Grid => indices.map((i) => indices.map((j) => grid[i][j]));

export type Grid = number[][];

/**
 * Anything mathjs hands back, as plain rows.
 *
 * Typed loosely on purpose: ts-fem carries its own copy of the mathjs types, so a `Matrix` from the
 * library and a `Matrix` from the app's mathjs are two unrelated types to the compiler even though
 * they are the same object at runtime. Narrowing here rather than at every call keeps that in one
 * place.
 */
const toGrid = (m: unknown): Grid => {
  const value = m as { toArray?: () => unknown };
  const array = (typeof value?.toArray === 'function' ? value.toArray() : m) as number | number[] | number[][];

  if (typeof array === 'number') return [[array]];

  return (Array.isArray(array[0]) ? array : [array as unknown as number[]]) as Grid;
};

const column = (m: unknown): Grid =>
  toGrid(m)
    .flat()
    .map((v) => [v]);

/**
 * The element's local stiffness matrix, before any release is condensed out.
 *
 * ts-fem builds the plain 6x6 and, when the element has a hinge, returns only the condensed result
 * - so the uncondensed one is put back together from the sub-blocks it hands over with it. That is
 * still the library's own matrix; nothing here re-derives it.
 */
export const localStiffness = (element: Beam2D, condensed: boolean): Grid => {
  const k = element.computeLocalStiffnessMtrx(true);

  if (condensed || !element.hasHinges() || !('kaa' in k) || k.kaa === undefined) return toGrid(k.answer);

  const kept = k.a as number[];
  const released = k.b as number[];
  const kaa = toGrid(k.kaa);
  const kab = toGrid(k.kab);
  const kbb = toGrid(k.kbb);

  const full: Grid = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 0));

  kept.forEach((row, i) => kept.forEach((col, j) => (full[row][col] = kaa[i][j])));
  kept.forEach((row, i) =>
    released.forEach((col, j) => {
      full[row][col] = kab[i][j];
      full[col][row] = kab[i][j];
    })
  );
  released.forEach((row, i) => released.forEach((col, j) => (full[row][col] = kbb[i][j])));

  return full;
};

/** The same element in the global system. Condensation is already applied by the library. */
export const globalStiffness = (element: Beam2D): Grid => toGrid(element.computeStiffness());

/** Global to local. Its transpose takes a local vector back to the global system. */
export const transformation = (element: Beam2D): Grid => toGrid(element.computeT());

export interface EndForces {
  /** From the loads on the element alone, with both ends held: the fixed end forces. */
  primary: Grid;
  /** From the end displacements the solved structure imposes. */
  secondary: Grid;
  /** What the element actually carries at its ends. */
  total: Grid;
}

/**
 * The fixed end forces after a release has been condensed out.
 *
 * A hinge cannot carry the moment the clamped beam would put there, so it is redistributed into the
 * degrees of freedom that remain: `f[a] - kab · kbb⁻¹ · f[b]`, with the released ones left at zero.
 * `computeEndForces` does this to the load vector before adding it to the stiffness part, so the
 * primary shown here has to be condensed too - otherwise primary plus secondary does not come to
 * the total, which is the one arithmetic anyone reading these three vectors will check.
 *
 * Without a hinge there is nothing to condense and the vector is returned as it came.
 */
const condensePrimary = (
  element: Beam2D,
  k: ReturnType<Beam2D['computeLocalStiffnessMtrx']>,
  raw: math.Matrix
): math.Matrix => {
  if (!element.hasHinges() || !('kaa' in k) || k.kaa === undefined) return raw;

  const kept = k.a as number[];
  const released = k.b as number[];
  const redistribute = toGrid(math.multiply(k.kab as never, math.inv(k.kbb as never) as never));
  const atReleased = released.map((dof) => (raw.get([dof]) as number) ?? 0);

  const condensed = math.zeros(6) as math.Matrix;

  kept.forEach((dof, row) => {
    const carried = redistribute[row].reduce((sum, factor, j) => sum + factor * atReleased[j], 0);

    condensed.set([dof], (raw.get([dof]) as number) - carried);
  });

  return condensed;
};

/**
 * End force vectors in the local system.
 *
 * Primary is the load vector for a clamped beam, summed over the loads on the element. Secondary is
 * the condensed stiffness against the end displacements. Their sum is what `computeEndForces`
 * reports, which makes the two an arithmetic check on each other.
 */
export const endForcesLocal = (element: Beam2D, loadCase: LoadCase): EndForces => {
  const displacement = element.computeEndDisplacement(loadCase);
  const k = element.computeLocalStiffnessMtrx(true);

  // both operands come from ts-fem's mathjs, which the app's copy does not recognise as its own
  const secondary = column(math.multiply(k.answer as never, displacement as never));

  let primaryVector = math.zeros(6) as math.Matrix;
  for (const load of loadCase.getElementLoadsOnElement(element.label)) {
    primaryVector = math.add(primaryVector, math.matrix(load.getLoadVectorForClampedBeam())) as math.Matrix;
  }

  const primary = column(condensePrimary(element, k, primaryVector));
  const total = column(element.computeEndForces(loadCase));

  return { primary, secondary, total };
};

/** The same three vectors in the global system: local to global is the transpose of T. */
export const endForcesGlobal = (element: Beam2D, loadCase: LoadCase): EndForces => {
  const local = endForcesLocal(element, loadCase);
  const t = math.transpose(element.computeT() as math.Matrix);
  const toGlobal = (v: Grid) => column(math.multiply(t, math.matrix(v.flat())) as math.Matrix);

  return {
    primary: toGlobal(local.primary),
    secondary: toGlobal(local.secondary),
    total: toGlobal(local.total),
  };
};

/**
 * The assembled structure matrix.
 *
 * The solver orders the free degrees of freedom first and the prescribed ones after, and solves
 * with the free block alone - so "reduced" here is that block, the one the structure is actually
 * solved on, and the full matrix is what was assembled before the supports were taken out of it.
 */
export const systemStiffness = (solver: Solver, reduced: boolean): Grid => {
  const full = toGrid(solver.k);

  if (!reduced) return full;

  return full.slice(0, solver.neq).map((row) => row.slice(0, solver.neq));
};

/**
 * The structure matrix assembled from a few elements rather than all of them.
 *
 * Each element contributes its 6x6 global matrix into the rows and columns its own degrees of
 * freedom occupy - `getLocationArray()` says which - and that scattering is the whole of assembly.
 * Seeing one element's contribution sitting in the big matrix is the point: it is where the two
 * pictures, the element and the structure, meet.
 *
 * The result keeps the structure's size and numbering, so it can be read against the full matrix
 * position for position.
 */
export const assembleFrom = (solver: Solver, elements: Beam2D[], reduced: boolean): Grid => {
  const size = solver.neq + solver.pneq;
  const grid: Grid = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));

  for (const element of elements) {
    const location = element.getLocationArray();
    const k = toGrid(element.computeStiffness());

    location.forEach((row, i) =>
      location.forEach((col, j) => {
        // a code number outside the structure means a degree of freedom this element does not share
        if (row >= 0 && col >= 0 && row < size && col < size) grid[row][col] += k[i][j];
      })
    );
  }

  if (!reduced) return grid;

  return grid.slice(0, solver.neq).map((row) => row.slice(0, solver.neq));
};

/** Whether the structure has been assembled and solved, so there is anything to read. */
export const hasSystemMatrix = (solver: Solver) => {
  try {
    return solver.neq + solver.pneq > 0 && toGrid(solver.k).length > 0;
  } catch {
    return false;
  }
};
