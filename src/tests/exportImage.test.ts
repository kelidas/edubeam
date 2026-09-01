import { describe, it, expect } from 'vitest';
import { splitAlpha } from '../utils/exportImage';

/**
 * `fill="transparent"` and friends come back from `getComputedStyle` as `rgba()`, which
 * SVG 1.1 renderers reject — Inkscape then falls back to the initial `fill`, opaque black,
 * and paints a slab over the drawing. The exporter has to hand the alpha to the separate
 * opacity property instead.
 */
const flatten = (declarations: Record<string, string>) => {
  const map = new Map(Object.entries(declarations));

  splitAlpha(map);

  return Object.fromEntries(map);
};

describe('splitAlpha', () => {
  it('turns fully transparent paint into none', () => {
    expect(flatten({ fill: 'rgba(0, 0, 0, 0)', 'fill-opacity': '1' })).toEqual({ fill: 'none' });
  });

  it('moves the alpha of a translucent paint into the opacity property', () => {
    expect(flatten({ fill: 'rgba(255, 255, 255, 0.8)' })).toEqual({
      fill: 'rgb(255, 255, 255)',
      'fill-opacity': '0.8',
    });
  });

  it('multiplies the alpha with an opacity the element already carries', () => {
    expect(flatten({ stroke: 'rgba(0, 0, 0, 0.5)', 'stroke-opacity': '0.5' })).toEqual({
      stroke: 'rgb(0, 0, 0)',
      'stroke-opacity': '0.25',
    });
  });

  it('leaves opaque paint alone', () => {
    const opaque = { fill: 'rgb(255, 135, 0)', 'fill-opacity': '1', stroke: 'none' };

    expect(flatten(opaque)).toEqual(opaque);
  });
});
