import { describe, it, expect } from 'vitest';
import { fitBounds } from '@/utils/fitBounds';

/**
 * A viewer on a hidden tab has never been measured. Nothing derived from its view may reach the
 * DOM as NaN: `translate(NaN NaN)` is what a browser reports when it does.
 */
describe('a view that cannot be measured', () => {
  it('produces no fit at all rather than a degenerate one', () => {
    const bounds = { minX: 0, minY: 0, maxX: 4, maxY: 0 };

    expect(fitBounds(bounds, { viewportWidth: 0, viewportHeight: 0 })).toBeNull();
    expect(fitBounds(bounds, { viewportWidth: NaN, viewportHeight: 100 })).toBeNull();
  });

  it('gives a finite view once there is a viewport', () => {
    const fit = fitBounds({ minX: 0, minY: 0, maxX: 4, maxY: 0 }, { viewportWidth: 640, viewportHeight: 480 })!;

    expect(Number.isFinite(fit.scale)).toBe(true);
    expect(Number.isFinite(fit.viewBox.x)).toBe(true);
    expect(fit.viewBox.w).toBeGreaterThan(0);
  });
});
