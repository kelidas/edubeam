import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewerStore } from '@/store/viewer';

/**
 * The two viewers are read for different things - the load case for its internal forces, the
 * influence line for its deflected shape - and both are mounted at once, so which results are
 * drawn cannot be one set of flags with the active workspace picking.
 *
 * What the drawing *looks* like stays shared: colours, type size, grid, labels. Only what it is
 * showing, and how tall, is split.
 */
describe('the result toggles', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('keeps the two workspaces apart', () => {
    const viewer = useViewerStore();

    viewer.resultsFor('viewer').showBendingMoment = true;
    viewer.resultsFor('influence').showBendingMoment = false;

    expect(viewer.resultsFor('viewer').showBendingMoment).toBe(true);
    expect(viewer.resultsFor('influence').showBendingMoment).toBe(false);
  });

  it('keeps their scales apart too', () => {
    const viewer = useViewerStore();

    viewer.resultsFor('influence').resultScale.deformedShape = 4;

    expect(viewer.resultsFor('viewer').resultScale.deformedShape).toBe(1);
  });

  it('opens the influence workspace on the deflected shape', () => {
    const influence = useViewerStore().resultsFor('influence');

    // the influence line *is* the deflected shape; a moment diagram there says nothing
    expect(influence.showDeformedShape).toBe(true);
    expect(influence.showBendingMoment).toBe(false);
  });

  it('opens the load case viewer on the moments', () => {
    const viewer = useViewerStore().resultsFor('viewer');

    expect(viewer.showBendingMoment).toBe(true);
    expect(viewer.showDeformedShape).toBe(true);
  });

  it('treats any id that is not the influence one as the load case viewer', () => {
    const viewer = useViewerStore();

    expect(viewer.resultsFor('viewer')).toBe(viewer.resultsFor('anything-else'));
    expect(viewer.resultsFor('influence')).not.toBe(viewer.resultsFor('viewer'));
  });

  it('restores both on a settings reset', () => {
    const viewer = useViewerStore();

    viewer.resultsFor('viewer').showNormalForce = true;
    viewer.resultsFor('influence').showBendingMoment = true;
    viewer.resultsFor('influence').resultScale.deformedShape = 9;

    viewer.reset();

    expect(viewer.resultsFor('viewer').showNormalForce).toBe(false);
    expect(viewer.resultsFor('influence').showBendingMoment).toBe(false);
    expect(viewer.resultsFor('influence').resultScale.deformedShape).toBe(1);
  });
});
