import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Which results are drawn is per workspace, so the drawing must reach those five flags through the
 * set belonging to *its* viewer - never through the store directly.
 *
 * Nothing catches this at runtime. The store no longer has the flags at the top level, so a binding
 * left on `useViewerStore().showNormalForce` reads and writes `undefined`: the checkbox renders,
 * takes the click, and changes nothing, in both viewers at once. That is exactly what happened -
 * a search-and-replace matched `viewerStore.x` and missed the `useViewerStore().x` call form, and
 * the whole suite stayed green.
 *
 * The appearance flags are deliberately not in this list: grid, labels, supports and loads are how
 * the drawing looks rather than what it shows, and they stay shared.
 */
const PER_WORKSPACE = ['showNormalForce', 'showShearForce', 'showBendingMoment', 'showDeformedShape', 'showReactions'];

const viewer = readFileSync(resolve(import.meta.dirname, '../components/SVGViewer.vue'), 'utf8');

describe('the result flags in the drawing', () => {
  for (const flag of PER_WORKSPACE) {
    it(`reads ${flag} from the viewer's own set`, () => {
      const throughStore = new RegExp(`(useViewerStore\\(\\)|viewerStore)\\.${flag}\\b`, 'g');
      const found = viewer.match(throughStore) ?? [];

      expect(found, `${flag} is per workspace; reach it through results.${flag}`).toEqual([]);
    });
  }

  it('reaches them through the per-viewer set instead', () => {
    for (const flag of PER_WORKSPACE) {
      expect(viewer, `nothing reads results.${flag}`).toContain(`results.${flag}`);
    }
  });

  it('leaves the shared appearance flags on the store', () => {
    // if these ever move too, this test should be updated rather than deleted
    expect(viewer).toMatch(/(useViewerStore\(\)|viewerStore)\.showNodeLabels\b/);
    expect(viewer).toMatch(/(useViewerStore\(\)|viewerStore)\.showSupports\b/);
  });
});
