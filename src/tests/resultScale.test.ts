import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useViewerStore } from '@/store/viewer';

describe('result scale factors', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts at one for every quantity', () => {
    const viewerStore = useViewerStore();

    expect(viewerStore.resultsFor('viewer').resultScale).toEqual({
      deformedShape: 1,
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
