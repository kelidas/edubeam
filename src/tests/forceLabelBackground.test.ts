import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ELEMENT = readFileSync(join(process.cwd(), 'src/components/svg/Element.vue'), 'utf-8');

/**
 * The plate behind a label is a white flood over the whole box of the text, not an outline around
 * the glyphs. Where the internal force labels sit - out beyond their own diagram, against the page
 * - white on white cannot be seen, and it keeps a value legible where two diagrams cross.
 *
 * Read from the source: what this is about is which elements are drawn, and a mounted component
 * would need a solved model and a laid-out viewer to show any of them.
 */
const labelGroup = (name: string) => {
  const at = ELEMENT.indexOf(`class="${name}`);

  expect(at, name).toBeGreaterThan(-1);

  // the enclosing <g>, which holds the backing copy of the text if there is one
  const from = ELEMENT.lastIndexOf('<g', at);

  return ELEMENT.slice(from, ELEMENT.indexOf('</g>', at));
};

describe('the plate behind a label', () => {
  it('is drawn behind an internal force value, where it cannot be seen', () => {
    expect(labelGroup('moment-label')).toContain('filter-text-label');
  });

  /**
   * The deflected shape carries no values of its own: it is the structure drawn where it moved to
   * rather than a quantity plotted along an axis, so a number written against it says less than the
   * section results widget does, and said it wrongly off a straight beam.
   */
  it('has nothing to sit behind on the deflected shape, which carries no values', () => {
    expect(ELEMENT).not.toContain('deflection-label');
  });
});
