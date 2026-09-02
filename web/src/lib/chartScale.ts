/** Shared "nice round numbers" axis-tick math (standard d3-style algorithm) — used by every chart under `components/`, so a fix here (see `decimalsForStep`'s doc comment) applies everywhere at once instead of drifting between copies. */

export function niceNum(range: number, round: boolean): number {
  if (range === 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  else niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return niceFraction * 10 ** exponent;
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min - 1, min, min + 1];
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v * 1e8) / 1e8);
  return ticks;
}

/**
 * How many decimal places an axis label needs to show adjacent ticks as
 * genuinely different numbers — e.g. a $0.10 step needs 2 decimals, a $50
 * step needs 0. Found the hard way: an equity overlay comparing two
 * sessions only ~$0.30 apart produced a real (not cosmetic) bug — five
 * gridlines at real, distinct Y positions all labeled "US$1,000" because
 * `formatUsd(t, 0)` rounded every tick to the same whole dollar. The fix
 * is precision derived from the tick step, not a hardcoded digit count.
 */
export function decimalsForStep(step: number): number {
  if (step <= 0 || step >= 1) return 0;
  return Math.max(0, Math.ceil(-Math.log10(step)));
}
