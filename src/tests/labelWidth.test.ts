import { describe, it, expect } from 'vitest';
import { MEASURED_AT, widthOf } from '@/utils/labelWidth';

/**
 * Measured in a browser, from the boxes the diagram's own labels rendered into at a font size of
 * nine - `getBBox().width` on the text elements of a section results widget. Nothing here can be
 * derived from the estimate itself: if the estimate drifts away from what a browser draws, the
 * diagram starts dropping labels that had room, or writing ones that overlap.
 */
const MEASURED: [string, number][] = [
  ['6.02', 17],
  ['-3.14', 18],
  ['1.4·10¹', 23],
  ['2.74·10¹', 29],
  ['-2.99·10¹', 33],
];

describe('the width of a number on a diagram', () => {
  it.each(MEASURED)('is about right for %s', (text, measured) => {
    const estimate = widthOf(text);

    expect(estimate).toBeGreaterThan(measured * 0.9);
    expect(estimate).toBeLessThan(measured * 1.25);
  });

  it('counts an exponent as narrower than the number in front of it', () => {
    // three superscript glyphs are not three digits, which is where the old guess went wrong
    expect(widthOf('1.4·10¹')).toBeLessThan(widthOf('1.4·1011'));
  });

  it('counts a separator as a fraction of a digit', () => {
    expect(widthOf('1.1')).toBeLessThan(widthOf('111') * 0.9);
  });

  it('is nothing for nothing', () => {
    expect(widthOf('')).toBe(0);
  });
});

describe('at other sizes', () => {
  it('scales with the font, since a glyph does', () => {
    expect(widthOf('123', 18)).toBeCloseTo(widthOf('123') * 2, 6);
    expect(widthOf('1.4·10¹', 12)).toBeCloseTo((widthOf('1.4·10¹') * 12) / 9, 6);
  });

  it('measures at nine when not told otherwise', () => {
    expect(widthOf('6.02', MEASURED_AT)).toBe(widthOf('6.02'));
  });
});
