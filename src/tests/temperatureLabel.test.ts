import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read as files rather than imported: the build compiles locale JSON into message functions, so an
 * import gives an abstract syntax tree where the string used to be.
 */
const DIRECTORY = join(process.cwd(), 'src/locales');

const languages = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith('.json'))
  .map((name) => [name, JSON.parse(readFileSync(join(DIRECTORY, name), 'utf-8')).loads as Record<string, string>]) as [
  string,
  Record<string, string>,
][];

const of = (language: string) => languages.find(([name]) => name === `${language}.json`)![1];

/**
 * An axial temperature change is written in three places - the dialog that sets it, the bottom bar
 * that lists it, and the drawing that labels it - and the drawing called it something else. One
 * load answering to two names depending on where it is read is the kind of thing a student takes
 * for two different quantities.
 */
describe('the name of an axial temperature change', () => {
  it('is the same letter in the drawing as in the dialog', () => {
    // the drawing cannot show markup, so it has a plain twin rather than a different name
    expect(of('en').temperatureDeltaTsNoHTML).toBe(of('en').temperatureDeltaTs.replace(/<\/?sub>/g, ''));
  });

  it('is there in Czech, which had neither and fell back to English', () => {
    expect(of('cs').temperatureDeltaTs).toBeTruthy();
    expect(of('cs').temperatureDeltaTsNoHTML).toBeTruthy();
  });

  it('is there in every language, in both forms', () => {
    for (const [name, loads] of languages) {
      expect(loads.temperatureDeltaTs, name).toBeTruthy();
      expect(loads.temperatureDeltaTsNoHTML, name).toBeTruthy();
      expect(loads.temperatureDeltaTbtNoHTML, name).toBeTruthy();
    }
  });

  it('carries no markup in the plain form, in any language', () => {
    for (const [name, loads] of languages) {
      expect(loads.temperatureDeltaTsNoHTML, name).not.toContain('<');
      expect(loads.temperatureDeltaTbtNoHTML, name).not.toContain('<');
    }
  });

  it('matches its own marked-up form in every language', () => {
    for (const [name, loads] of languages) {
      expect(loads.temperatureDeltaTsNoHTML, name).toBe(loads.temperatureDeltaTs.replace(/<\/?sub>/g, ''));
      expect(loads.temperatureDeltaTbtNoHTML, name).toBe(loads.temperatureDeltaTbt.replace(/<\/?sub>/g, ''));
    }
  });

  it('keeps each language’s own subscript for the difference', () => {
    // bottom and top in English, dolní and horní in Czech: the letters are not translations
    expect(of('en').temperatureDeltaTbtNoHTML).toBe('ΔTb-ΔTt');
    expect(of('cs').temperatureDeltaTbtNoHTML).toBe('ΔTd-ΔTh');
  });
});
