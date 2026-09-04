import type { Matrix } from 'mathjs';
import type { LoadCase, Node } from 'ts-fem';

/**
 * Reactions this far below the largest one in the model are float noise rather than results.
 * A reaction that is zero by statics only comes out as an exact 0 when it falls out of a
 * decoupled equation; as soon as it is a cancellation between large terms - a rotated support
 * is the usual way in - it lands around 1e-13 and would be drawn as a "0.00" arrow.
 */
const RELATIVE_TOLERANCE = 1e-9;

/** Every reaction component of a node, in whichever frame it is reported. */
export const getNodeReactions = (node: Node, loadCase: LoadCase): number[] => {
  const r = node.getReactions(loadCase, !node.hasLcs());

  return r.dofs.map((_, i) => ('get' in r.values ? (r.values as unknown as Matrix).get([i]) : r.values[i]));
};

/**
 * Magnitude below which a reaction should be treated as zero and left undrawn. Forces and moments
 * share one scale on purpose: a rotated support turns a genuine zero into noise in every component
 * at once, so a per-unit scale would keep the lone noisy moment it is meant to discard.
 */
export const computeReactionThreshold = (nodes: Iterable<Node>, loadCase: LoadCase | undefined): number => {
  if (!loadCase?.solved) return 0;

  let largest = 0;

  for (const node of nodes) {
    if (node.bcs.size === 0) continue;

    for (const value of getNodeReactions(node, loadCase)) {
      largest = Math.max(largest, Math.abs(value));
    }
  }

  return largest * RELATIVE_TOLERANCE;
};
