import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewerStore } from '@/store/viewer';

describe('result scale factors', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts at one for every quantity', () => {
    const viewerStore = useViewerStore();

    expect(viewerStore.resultsFor('viewer').resultScale).toEqual({
      deformedShape: 1,
      rotation: 1,
      normalForce: 1,
      shearForce: 1,
      bendingMoment: 1,
    });
  });

  it('is restored by a settings reset', () => {
    const viewerStore = useViewerStore();

    viewerStore.resultsFor('viewer').resultScale.bendingMoment = 4;
    viewerStore.reset();

    expect(viewerStore.resultsFor('viewer').resultScale.bendingMoment).toBe(1);
  });
});

/**
 * The rotation is drawn like the deflected shape - what the beam does rather than what it carries -
 * so it is scaled to its own largest value and starts switched off, the diagram being one more
 * curve over the same drawing.
 */
describe('the rotation diagram', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('is offered in both workspaces and shown in neither to begin with', () => {
    const viewerStore = useViewerStore();

    expect(viewerStore.resultsFor('viewer').showRotation).toBe(false);
    expect(viewerStore.resultsFor('influence').showRotation).toBe(false);
  });

  it('has a scale of its own to adjust', () => {
    const viewerStore = useViewerStore();

    viewerStore.resultsFor('influence').resultScale.rotation = 3;

    expect(viewerStore.resultsFor('viewer').resultScale.rotation).toBe(1);
  });

  it('has a colour of its own, not one borrowed from another quantity', () => {
    const { colors } = useViewerStore();
    const others = [
      colors.deformedShape,
      colors.normalForce,
      colors.shearForce,
      colors.bendingMoment,
      colors.reactions,
    ];

    expect(colors.rotation).toBeTruthy();
    expect(others).not.toContain(colors.rotation);
  });
});
