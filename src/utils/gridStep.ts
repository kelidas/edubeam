/**
 * Spacing of the grid lines: a round number of model units, chosen so the lines land roughly
 * every 40 screen pixels.
 *
 * Returns null when the view cannot be measured - a viewer on a hidden tab has no size, and the
 * arithmetic below would run through log10(0) and hand back NaN, which reaches the DOM as
 * `translate(NaN NaN)`.
 *
 * @param modelSpan width of the view in model units
 * @param pixelSpan width of the view on screen
 */
export const gridStep = (modelSpan: number, pixelSpan: number): number | null => {
  if (!Number.isFinite(modelSpan) || !Number.isFinite(pixelSpan)) return null;
  if (modelSpan <= 0 || pixelSpan <= 0) return null;

  const tickCount = Math.floor(pixelSpan / 40);
  if (tickCount < 2) return null;

  const perTick = modelSpan / (tickCount - 1);
  if (!Number.isFinite(perTick) || perTick <= 0) return null;

  const magnitude = Math.pow(10, Math.ceil(Math.log10(perTick) - 1));
  const step = Math.ceil(perTick / magnitude) * magnitude;

  return Number.isFinite(step) && step > 0 ? step : null;
};
