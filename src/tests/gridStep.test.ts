import { describe, it, expect } from 'vitest';
import { gridStep } from '@/utils/gridStep';

describe('grid step', () => {
  it('is a round number of model units, about every 40 pixels', () => {
    expect(gridStep(10, 800)).toBeCloseTo(0.6, 12);
    expect(gridStep(100, 800)).toBeCloseTo(6, 12);
    expect(gridStep(1, 400)).toBeCloseTo(0.2, 12);
  });

  it('gives nothing for a view that cannot be measured', () => {
    // a viewer on a hidden tab: no size, and a span that maps to nothing
    expect(gridStep(0, 0)).toBeNull();
    expect(gridStep(10, 0)).toBeNull();
    expect(gridStep(0, 800)).toBeNull();
    expect(gridStep(NaN, 800)).toBeNull();
    expect(gridStep(10, NaN)).toBeNull();
    expect(gridStep(Infinity, 800)).toBeNull();
  });

  it('gives nothing rather than a step for a viewport too small to tick', () => {
    expect(gridStep(10, 39)).toBeNull();
  });
});
