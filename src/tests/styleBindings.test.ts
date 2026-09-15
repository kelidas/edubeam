import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every `v-bind` in a style block names something its own component has.
 *
 * A style's `v-bind` is compiled into a watcher that runs after the component mounts, so naming
 * something that is not there is not a compile error and not a render error either - it throws into
 * a queue whose failures reach no caller. It cannot be caught by mounting the component in a test:
 * styles are not compiled here at all, so the watcher is never made. It can be read off the source,
 * which is what this does.
 *
 * The case that prompted it: a rule copied from the big drawing into the small one, naming the
 * viewer's store, which the small one does not have - it takes its colours from a prop. Opening any
 * widget threw.
 */
const componentsIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return componentsIn(path);

    return entry.name.endsWith('.vue') ? [path] : [];
  });

/** The first name of each expression: `v-bind('colors.loads')` is about `colors`. */
const boundNames = (source: string) => {
  const style = source.slice(source.indexOf('<style'));

  return [...style.matchAll(/v-bind\(\s*['"]?([A-Za-z_$][\w$]*)/g)].map((match) => match[1]);
};

const scriptOf = (source: string) => source.slice(0, source.indexOf('<template'));

describe('what a style binds to', () => {
  const components = componentsIn(join(process.cwd(), 'src/components'));

  it('finds the components to check', () => {
    expect(components.length).toBeGreaterThan(20);
  });

  it('is something the component itself has', () => {
    for (const path of components) {
      const source = readFileSync(path, 'utf-8');

      if (!source.includes('<style')) continue;

      const script = scriptOf(source);

      for (const name of boundNames(source)) {
        expect(script, `${path} binds to ${name}`).toMatch(new RegExp(`\\b${name}\\b`));
      }
    }
  });
});
