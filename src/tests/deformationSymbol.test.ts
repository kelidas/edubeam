import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { LinearStaticSolver } from 'ts-fem';
import Deformation from '../components/svg/ElementConcentratedDeformation.vue';
import { axisConvention } from '../utils/axisConvention';

/** The drawing is in model units, so the scale is how many pixels of symbol go to one of them. */
const SCALE = 10;

const drawn = (values: number[], scale = SCALE, endsAt: [number, number, number] = [4, 0, 0]) => {
  const solver = new LinearStaticSolver();
  const d = solver.domain;

  d.createNode(1, [0, 0, 0], []);
  d.createNode(2, endsAt, []);
  d.createMaterial(1, { e: 1, g: 1, alpha: 0, d: 0 });
  d.createCrossSection(1, { a: 1, iy: 1, h: 1, k: 1 });
  d.createBeam2D(1, [1, 2], 1, 1);
  solver.loadCases[0].createBeamConcentratedDeformation(1, values, true);

  return mount(Deformation, {
    props: {
      eload: solver.loadCases[0].elementLoadList[0],
      scale,
      convertDisplacement: (v: number) => v,
      numberFormat: new Intl.NumberFormat(),
    },
  });
};

const turnOf = (transform: string) => Number(/rotate\(([-\d.e]+)/.exec(transform)![1]);
const alongOf = (transform: string) => Number(/translate\(([-\d.e]+)/.exec(transform)![1]);
const acrossOf = (transform: string) => Number(/translate\([-\d.e]+ ([-\d.e]+)/.exec(transform)![1]);
const startOf = (points: string) => points.split(' ')[0].split(',').map(Number);

describe('imposed deformation symbol', () => {
  it('draws a dashed shaft along the arrow', () => {
    const solver = new LinearStaticSolver();
    const d = solver.domain;
    d.createNode(1, [0, 0, 0], []);
    d.createNode(2, [4, 0, 0], []);
    d.createMaterial(1, { e: 1, g: 1, alpha: 0, d: 0 });
    d.createCrossSection(1, { a: 1, iy: 1, h: 1, k: 1 });
    d.createBeam2D(1, [1, 2], 1, 1);
    solver.loadCases[0].createBeamConcentratedDeformation(1, [0, -1, 0, 2], true);

    const wrapper = mount(Deformation, {
      props: {
        eload: solver.loadCases[0].elementLoadList[0],
        scale: 10,
        convertDisplacement: (v: number) => v,
        numberFormat: new Intl.NumberFormat(),
      },
    });

    const shaft = wrapper.find('polyline.decoration.shaft');
    expect(shaft.exists()).toBe(true);
    expect(shaft.attributes('stroke-dasharray')).toBe('6 4');
  });

  /**
   * An imposed deformation is a relative movement of the two faces of a section, not something
   * applied to one point of it. Drawn as one arrow it reads as a load; drawn as two against each
   * other it reads as a release, which is what an influence line is drawn from.
   */
  it('draws an arrow for each face of the cut', () => {
    const wrapper = drawn([0, -1, 0, 2]);

    expect(wrapper.findAll('polyline.decoration.force')).toHaveLength(2);
    expect(wrapper.findAll('polyline.decoration.shaft')).toHaveLength(2);
  });

  it('points the two against each other', () => {
    const turns = drawn([0, -1, 0, 2])
      .findAll('polyline.decoration.force')
      .map((a) => turnOf(a.attributes('transform')!));
    const between = (((turns[1] - turns[0]) % 360) + 360) % 360;

    expect(Math.abs(between - 180)).toBeLessThan(1e-6);
  });

  const shaftsAlong = (values: number[], scale = SCALE) =>
    drawn(values, scale)
      .findAll('polyline.decoration.shaft')
      .map((shaft) => startOf(shaft.attributes('points')!)[0]);

  it('stands them either side of the section', () => {
    const along = shaftsAlong([0, -1, 0, 2]);

    expect(along[0]).toBeLessThan(2);
    expect(along[1]).toBeGreaterThan(2);
  });

  it('keeps them the same distance apart on the screen at any zoom', () => {
    const near = shaftsAlong([0, -1, 0, 2], SCALE);
    const far = shaftsAlong([0, -1, 0, 2], SCALE * 4);

    // four times the zoom, a quarter of the model distance: the gap is a fixed number of pixels
    expect(Math.abs(near[1] - near[0])).toBeCloseTo(Math.abs(far[1] - far[0]) * 4, 9);
  });

  it('puts the head at the far end, so the arrow points away from the beam', () => {
    const wrapper = drawn([0, -1, 0, 2]);
    const head = wrapper.find('polyline.decoration.force').attributes('transform')!;
    const [fromX, fromZ] = startOf(wrapper.find('polyline.decoration.shaft').attributes('points')!);

    expect(Math.hypot(alongOf(head) - fromX, acrossOf(head) - fromZ)).toBeCloseTo(40 / SCALE, 6);
  });

  /**
   * Two halves of one circle, standing on the section with a gap where it is. Drawn as paths rather
   * than hung off a marker: a marker is anchored by a reference point fitted along with its own
   * view box, and getting the centre of a circle to land on the section that way is guesswork.
   */
  const arcsOf = (values: number[]) => drawn(values).findAll('path.dislocation-rotation');

  it('draws two halves of a circle for an imposed rotation', () => {
    const arcs = arcsOf([0, 0, 1, 2]);

    expect(arcs).toHaveLength(2);
    // each is an arc of one radius, which is what makes the two of them a circle
    arcs.forEach((arc) => expect(arc.attributes('d')).toMatch(/^M [-\d.e]+ [-\d.e]+ A ([-\d.e]+) \1 0 0 [01] /));
  });

  const headsOf = (values: number[]) =>
    arcsOf(values).map((arc) => {
      const [, from, to] = arc.attributes('d')!.match(/^M [-\d.e]+ ([-\d.e]+) A .* ([-\d.e]+)$/)!;

      // z counts downwards, so an end above where it started is the smaller number
      return Number(to) < Number(from) ? 'up' : 'down';
    });

  it('ends both heads at the same end of the circle', () => {
    expect(headsOf([0, 0, 1, 2])).toEqual(['up', 'up']);
  });

  it('sends them to the other end for a negative rotation', () => {
    expect(headsOf([0, 0, -1, 2])).toEqual(['down', 'down']);
  });

  it('bulges each half away from the other, so the two close a circle', () => {
    const sweeps = arcsOf([0, 0, 1, 2]).map((arc) => arc.attributes('d')!.match(/A [-\d.e]+ [-\d.e]+ 0 0 ([01])/)![1]);

    // one half round one way and the other round the other, from the same direction of travel
    expect(sweeps[0]).not.toBe(sweeps[1]);
  });

  it('leaves a gap between the halves rather than standing them apart', () => {
    const arcs = arcsOf([0, 0, 1, 2]);
    const centres = arcs.map((arc) => Number(arc.attributes('d')!.split(' ')[1]));
    const radius = Number(arcs[0].attributes('d')!.match(/A ([-\d.e]+)/)![1]);

    // wide enough apart that the two heads clear each other, near enough to close one circle
    expect(Math.abs(centres[1] - centres[0])).toBeGreaterThan(0);
    expect(Math.abs(centres[1] - centres[0])).toBeLessThan(radius);
  });

  it('draws nothing of the kind the load does not have', () => {
    expect(arcsOf([0, -1, 0, 2])).toHaveLength(0);
    expect(drawn([0, 0, 1, 2]).findAll('polyline.decoration.force')).toHaveLength(0);
  });

  /**
   * The release itself, beside the arrows that say how far it opens: the arrows are the size of the
   * movement, these are what kind of movement it is.
   */
  const shaftsAcross = (values: number[]) =>
    drawn(values)
      .findAll('polyline.decoration.shaft')
      .map((shaft) => startOf(shaft.attributes('points')!)[1]);

  it('sets the two arrows of a slip along the beam either side of it', () => {
    // colinear, they would be one line with a head at each end, saying nothing about which face is which
    const across = shaftsAcross([1, 0, 0, 2]);

    expect(Math.sign(across[0])).toBe(-Math.sign(across[1]));
    expect(Math.abs(across[1] - across[0])).toBeGreaterThan(0);
  });

  const platesOf = (values: number[]) => drawn(values).findAll('polyline.release.plate');

  it('draws a sliding plate for a slip, lying the way the faces travel', () => {
    // the beam runs along x, so a slip along it gets plates along x and a slip across it plates along z
    const [alongFrom, alongTo] = [platesOf([1, 0, 0, 2])[0], platesOf([0, 1, 0, 2])[0]].map((plate) => {
      const [from, to] = plate
        .attributes('points')!
        .split(' ')
        .map((p) => p.split(',').map(Number));

      return { dx: Math.abs(to[0] - from[0]), dz: Math.abs(to[1] - from[1]) };
    });

    expect(alongFrom.dx).toBeGreaterThan(0);
    expect(alongFrom.dz).toBeCloseTo(0, 9);
    expect(alongTo.dz).toBeGreaterThan(0);
    expect(alongTo.dx).toBeCloseTo(0, 9);
  });

  it('runs three rollers between the two plates', () => {
    expect(platesOf([1, 0, 0, 2])).toHaveLength(2);
    expect(drawn([1, 0, 0, 2]).findAll('circle.release.roller')).toHaveLength(3);
  });

  it('puts a hinge at the section of an imposed rotation, and only there', () => {
    const hinge = drawn([0, 0, 1, 2]).find('circle.release.hinge');

    expect(hinge.exists()).toBe(true);
    expect(Number(hinge.attributes('cx'))).toBeCloseTo(2, 9);
    expect(drawn([1, 0, 0, 2]).find('circle.release.hinge').exists()).toBe(false);
    expect(drawn([0, 0, 1, 2]).findAll('polyline.release.plate')).toHaveLength(0);
  });

  /**
   * The pair of half circles straddles the section, and the section runs across the beam whichever
   * way the beam runs - so the symbol turns with the element, as the arrows beside it do.
   */
  const arcEndsOf = (endsAt: [number, number, number]) =>
    drawn([0, 0, 1, 2], SCALE, endsAt)
      .findAll('path.dislocation-rotation')
      .map((arc) => {
        const [, x1, z1, x2, z2] = arc.attributes('d')!.match(/^M ([-\d.e]+) ([-\d.e]+) A .* ([-\d.e]+) ([-\d.e]+)$/)!;

        return { dx: Math.abs(Number(x2) - Number(x1)), dz: Math.abs(Number(z2) - Number(z1)) };
      });

  it('turns the circle with the element', () => {
    // on a beam along x the two ends of each half circle sit one above the other
    arcEndsOf([4, 0, 0]).forEach((ends) => {
      expect(ends.dx).toBeCloseTo(0, 9);
      expect(ends.dz).toBeGreaterThan(0);
    });

    // and on a column they sit side by side, the whole symbol having turned with it
    arcEndsOf([0, 0, 4]).forEach((ends) => {
      expect(ends.dz).toBeCloseTo(0, 9);
      expect(ends.dx).toBeGreaterThan(0);
    });
  });

  it('keeps every release the same size on the screen at any zoom', () => {
    const radius = (scale: number) => Number(drawn([0, 0, 1, 2], scale).find('circle.release.hinge').attributes('r'));

    expect(radius(SCALE)).toBeCloseTo(radius(SCALE * 4) * 4, 9);
  });

  /**
   * The numbers beside the symbol are read in the system the reader chose, as every other value on
   * the drawing is: the component across the beam turns over with the vertical axis, the one along
   * it does not. The symbol itself is drawn from the model and does not move.
   */
  describe('in the y up convention', () => {
    afterEach(() => (axisConvention.value = 'z-down'));

    const pairLabel = (values: number[]) => {
      const text = drawn(values)
        .findAll('text')
        .map((t) => t.text())
        .join(' ');

      return /\(([^)]*)\)/.exec(text)![1];
    };

    it('turns the component across the beam over, and leaves the one along it', () => {
      const down = pairLabel([0.01, -0.02, 0, 2]);

      axisConvention.value = 'y-up';
      const up = pairLabel([0.01, -0.02, 0, 2]);

      const [alongDown, acrossDown] = down.split(';').map((part) => Number(part.trim()));
      const [alongUp, acrossUp] = up.split(';').map((part) => Number(part.trim()));

      expect(alongUp).toBeCloseTo(alongDown, 12);
      expect(acrossUp).toBeCloseTo(-acrossDown, 12);
    });
  });
});
