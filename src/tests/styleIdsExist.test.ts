import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A rule that names an id nothing carries any more.
 *
 * Styles and template drift apart silently: the id in the template is renamed - here, by taking
 * upstream's name for the strip in the corner of the drawing - and the rule that sized it for a
 * finger goes on matching nothing. Everything looks right on a mouse, and on a touch screen one
 * corner of the app stays small while the rest of the buttons grow.
 *
 * Nothing here lays anything out; it reads the sources, as `styleBindings.test.ts` does for
 * `v-bind()` in a style block.
 */
describe('id selectors in a component stylesheet', () => {
  const root = join(process.cwd(), 'src/components');

  /** `#e3f2fd` is a colour, not an id. */
  const isColour = (name: string) => /^[0-9a-fA-F]{3,8}$/.test(name);

  const components = readdirSync(root, { recursive: true, encoding: 'utf-8' })
    .filter((path) => path.endsWith('.vue'))
    .map((path) => ({ path, source: readFileSync(join(root, path), 'utf-8') }));

  it('finds the components to check', () => {
    expect(components.length).toBeGreaterThan(20);
  });

  it('name something the component renders', () => {
    const orphans: string[] = [];

    for (const { path, source } of components) {
      const styles = [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');

      if (!styles) continue;

      const elsewhere = source.replace(styles, '');
      const named = new Set([...styles.matchAll(/#([A-Za-z][\w-]*)/g)].map((match) => match[1]));

      for (const id of named) {
        if (isColour(id)) continue;
        // as an attribute, or handed to a component that puts it on its own root
        if (elsewhere.includes(`id="${id}"`) || elsewhere.includes(`'${id}'`)) continue;

        orphans.push(`${path}: #${id}`);
      }
    }

    expect(orphans).toEqual([]);
  });
});
