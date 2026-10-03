/**
 * Which prescribed displacements the drawing shows.
 *
 * Several can sit on one support - the influence lines tab keeps a unit dislocation for each
 * reaction there and switches between them - and their symbols would lie on top of each other.
 * Where a node has more than one, only the switched-on ones are drawn, or the first if none is on,
 * and the rest are left to the loads table. The index is the load's own, which selection and the
 * edit dialog go by.
 */
export const drawnPrescribed = <T extends { target: string | number; active?: boolean }>(loads: T[]) => {
  const atNode = new Map<string, number[]>();

  loads.forEach((load, index) => {
    const node = String(load.target);
    atNode.set(node, [...(atNode.get(node) ?? []), index]);
  });

  const shown = new Set<number>();

  for (const indices of atNode.values()) {
    const on = indices.filter((i) => loads[i].active !== false);
    for (const i of indices.length === 1 ? indices : on.length > 0 ? on : [indices[0]]) shown.add(i);
  }

  return loads.flatMap((nload, index) => (shown.has(index) ? [{ nload, index }] : []));
};
