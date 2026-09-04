import { describe, it, expect } from 'vitest';
import { LinearStaticSolver, DofID } from 'ts-fem';
import { computeReactionThreshold, getNodeReactions } from '@/utils/reactionThreshold';

const material = { d: 7850, e: 210e9, g: 80e9, alpha: 12e-6 };
const section = { a: 0.01, iy: 8e-5, h: 0.2, k: 1e32 };

/** Support rotated onto the member axis and pulled along it: only the axial reaction is real. */
const buildRotatedSupport = () => {
  const angle = (30 * Math.PI) / 180;
  const ls = new LinearStaticSolver();
  const d = ls.domain;

  const n1 = d.createNode(1, [0, 0, 0], [DofID.Dx, DofID.Dz, DofID.Ry]);
  n1.updateLcs({ locx: [Math.cos(angle), 0, Math.sin(angle)], locy: [0, 1, 0] });
  d.createNode(2, [4 * Math.cos(angle), 0, 4 * Math.sin(angle)], []);
  d.createMaterial(1, material);
  d.createCrossSection(1, section);
  d.createBeam2D(1, [1, 2], 1, 1);
  ls.loadCases[0].createNodalLoad(2, {
    [DofID.Dx]: 10000 * Math.cos(angle),
    [DofID.Dz]: 10000 * Math.sin(angle),
    [DofID.Ry]: 0,
  });
  ls.solve();

  return ls;
};

describe('computeReactionThreshold', () => {
  it('separates a real reaction from the noise left by a cancellation', () => {
    const ls = buildRotatedSupport();
    const threshold = computeReactionThreshold(ls.domain.nodes.values(), ls.loadCases[0]);
    const [axial, transverse, moment] = getNodeReactions(ls.domain.getNode(1), ls.loadCases[0]);

    // The transverse force and the moment are zero by statics, but arrive as float noise.
    expect(Math.abs(transverse)).toBeGreaterThan(0);
    expect(Math.abs(transverse)).toBeLessThan(1e-6);
    expect(Math.abs(moment)).toBeGreaterThan(0);
    expect(Math.abs(moment)).toBeLessThan(1e-6);

    expect(Math.abs(axial)).toBeGreaterThan(threshold);
    expect(Math.abs(transverse)).toBeLessThan(threshold);
    expect(Math.abs(moment)).toBeLessThan(threshold);
  });

  it('keeps a small but genuine reaction', () => {
    const ls = new LinearStaticSolver();
    const d = ls.domain;
    d.createNode(1, [0, 0, 0], [DofID.Dx, DofID.Dz]);
    d.createNode(2, [3, 0, 0], []);
    d.createNode(3, [6, 0, 0], [DofID.Dz]);
    d.createMaterial(1, material);
    d.createCrossSection(1, section);
    d.createBeam2D(1, [1, 2], 1, 1);
    d.createBeam2D(2, [2, 3], 1, 1);
    // Off-centre, so the two vertical reactions differ by a lot but both are real.
    ls.loadCases[0].createNodalLoad(2, { [DofID.Dx]: 0, [DofID.Dz]: 10000, [DofID.Ry]: 0 });
    ls.solve();

    const threshold = computeReactionThreshold(ls.domain.nodes.values(), ls.loadCases[0]);

    expect(Math.abs(getNodeReactions(ls.domain.getNode(3), ls.loadCases[0])[0])).toBeGreaterThan(threshold);
  });

  it('is zero for an unsolved load case, so nothing is hidden by accident', () => {
    const ls = buildRotatedSupport();
    ls.loadCases[0].solved = false;

    expect(computeReactionThreshold(ls.domain.nodes.values(), ls.loadCases[0])).toBe(0);
  });
});
