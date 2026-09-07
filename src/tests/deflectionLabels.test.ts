import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { LinearStaticSolver, DofID } from 'ts-fem';
import SVGElement from '../components/svg/Element.vue';

const solved = (withLoad: boolean, cantilever = false) => {
  const solver = new LinearStaticSolver();
  const d = solver.domain;

  d.createNode(1, [0, 0, 0], cantilever ? [DofID.Dx, DofID.Dz, DofID.Ry] : [DofID.Dx, DofID.Dz]);
  d.createNode(2, [4, 0, 0], cantilever ? [] : [DofID.Dz]);
  d.createMaterial(1, { e: 210000e6, g: 8.75e10, alpha: 12e-6, d: 4000 });
  d.createCrossSection(1, { a: 1, iy: 8.356e-5, iz: 1, dyz: 999991, h: 1, k: 1e32, j: 99999 });
  d.createBeam2D(1, [1, 2], 1, 1);

  if (withLoad) solver.loadCases[0].createBeamConcentratedLoad(1, [0, 1000, 0, 1.5], true);

  solver.solve();

  return solver;
};

const labels = (solver: LinearStaticSolver) => {
  const wrapper = mount(SVGElement, {
    props: {
      element: solver.domain.getElement(1),
      scale: 10,
      showGeometry: false,
      showResults: true,
      showDeformedShape: true,
      loadCase: solver.loadCases[0],
      deformedShapeMultiplier: 100,
      convertLength: (v: number) => v,
      showDeflectionLabels: true,
      deformationNumberFormat: new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }),
    },
  });

  return wrapper.findAll('text.deflection-label:not(.filter-text-label)').map((t) => t.text());
};

const labelPositions = (solver: LinearStaticSolver) => {
  const wrapper = mount(SVGElement, {
    props: {
      element: solver.domain.getElement(1),
      scale: 10,
      showGeometry: false,
      showResults: true,
      showDeformedShape: true,
      loadCase: solver.loadCases[0],
      deformedShapeMultiplier: 100,
      convertLength: (v: number) => v,
      showDeflectionLabels: true,
      deformationNumberFormat: new Intl.NumberFormat('en', { maximumSignificantDigits: 4 }),
    },
  });

  return wrapper
    .findAll('g[data-fit-ignore="results"]')
    .map((g) => /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.attributes('transform') ?? ''))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ x: Number(m[1]), z: Number(m[2]) }));
};

describe('deflection labels', () => {
  it('labels the deflection under a concentrated load', () => {
    const texts = labels(solved(true));

    expect(texts.length).toBeGreaterThan(0);
    // a deflection in metres, written as a power of ten rather than a row of zeros
    expect(texts[0]).toMatch(/^-?[\d.,]+·10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+$/);
  });

  it('labels nothing where the element does not deflect', () => {
    // both ends supported, nothing loaded: every station reads zero
    expect(labels(solved(false))).toEqual([]);
  });

  it('labels the deflection at a node that moves', () => {
    const texts = labels(solved(true, true));

    expect(texts.length).toBeGreaterThan(0);
    expect(texts[texts.length - 1]).toMatch(/^-?[\d.,]+·10[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+$/);
  });

  it('places the label clear of the curve, on the side it deflected to', () => {
    const solver = solved(true, true);
    const tip = solver.domain.getElement(1).computeGlobalDeflAt(solver.loadCases[0], 4);
    const curveZ = tip.w * (100 / 10);

    const label = labelPositions(solver).pop()!;

    expect(Math.sign(label.z)).toBe(Math.sign(curveZ));
    expect(Math.abs(label.z)).toBeGreaterThan(Math.abs(curveZ));
  });
});

describe('deflection labels off the influence workspace', () => {
  it('draws none, and keeps the smooth curve', () => {
    const solver = solved(true);
    const wrapper = mount(SVGElement, {
      props: {
        element: solver.domain.getElement(1),
        scale: 10,
        showGeometry: false,
        showResults: true,
        showDeformedShape: true,
        loadCase: solver.loadCases[0],
        deformedShapeMultiplier: 100,
        convertLength: (v: number) => v,
      },
    });

    expect(wrapper.findAll('text.deflection-label')).toHaveLength(0);
    // a spline, not the straight polyline the influence line needs
    expect(wrapper.find('path.deformedShape').attributes('d')).toContain('C');
  });
});
