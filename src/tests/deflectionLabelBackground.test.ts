import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ELEMENT = readFileSync(join(process.cwd(), 'src/components/svg/Element.vue'), 'utf-8');

/**
 * The plate behind a label is a white flood over the whole box of the text, not an outline around
 * the glyphs. Where the internal force labels sit - out beyond their own diagram, against the page
 * - white on white cannot be seen. An influence line is drawn filled and its values sit on top of
 * that fill, so there the same plate reads as a white card laid over the shape.
 *
 * Read from the source: what this is about is which elements are drawn, and a mounted component
 * would need a solved influence line and a laid-out viewer to show any of them.
 */
const labelGroup = (name: string) => {
  const at = ELEMENT.indexOf(`class="${name}`);

  expect(at, name).toBeGreaterThan(-1);

  // the enclosing <g>, which holds the backing copy of the text if there is one
  const from = ELEMENT.lastIndexOf('<g', at);

  return ELEMENT.slice(from, ELEMENT.indexOf('</g>', at));
};

describe('the plate behind a label', () => {
  it('is not drawn behind a deflection value', () => {
    expect(labelGroup('deflection-label')).not.toContain('filter-text-label');
  });

  it('is still drawn behind an internal force value, where it cannot be seen', () => {
    // removing it there would be a change to the main viewer, which reads well as it is
    expect(labelGroup('moment-label')).toContain('filter-text-label');
  });

  it('leaves the deflection value itself, written once', () => {
    const occurrences = ELEMENT.split('class="deflection-label').length - 1;

    expect(occurrences).toBe(1);
  });
});
