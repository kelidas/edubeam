/**
 * How wide a number will be drawn, before it is drawn.
 *
 * A diagram has to know whether two labels would be written on top of one another while it is
 * deciding which of them to write, so it cannot measure them. Counting every character the same is
 * what a rough guess looks like, and it was half again too wide: an exponent is three narrow glyphs
 * and a decimal separator is a third of a digit. Labels with room to spare were dropped for
 * collisions that never happened.
 *
 * The widths are read off rendered boxes, and the test holds them to those. It leans a little wide
 * rather than a little short: two numbers that touch are easier to live with than one that was
 * dropped for nothing.
 */

/** At a font size of nine, which is what the diagrams use. */
const GLYPH_WIDTHS: Record<string, number> = {
  '.': 2.3,
  ',': 2.3,
  '-': 2.9,
  '−': 2.9,
  '·': 2.6,
  '⁻': 2.0,
};

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

const DIGIT = 4.7;
const SUPERSCRIPT_DIGIT = 3.0;

export const widthOf = (text: string) =>
  [...text].reduce((width, glyph) => {
    if (GLYPH_WIDTHS[glyph] !== undefined) return width + GLYPH_WIDTHS[glyph];

    return width + (SUPERSCRIPT_DIGITS.includes(glyph) ? SUPERSCRIPT_DIGIT : DIGIT);
  }, 0);
