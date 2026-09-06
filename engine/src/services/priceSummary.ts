import type { Candle } from "@coinbase-trading-bot/shared";

/**
 * Aggregate price context for a backtest's candle window — what the MARKET
 * did over the period, as opposed to what the strategy did with it (that's
 * `backtestAnalytics.ts`).
 *
 * Both close- and high/low-based extremes are reported on purpose: the
 * backtest fill logic only ever looks at a candle's `close`, so `minClose`/
 * `maxClose` describe the prices the strategy could actually act on, while
 * `minLow`/`maxHigh` describe the prices the market genuinely touched
 * intra-candle. A configured level sitting between the two is the classic
 * "why did nothing fill?" case this summary exists to make visible.
 */
export interface PriceSummary {
  minClose: number;
  maxClose: number;
  avgClose: number;
  minLow: number;
  maxHigh: number;
}

/**
 * Pure reduction over an ordered (or unordered — order doesn't matter here)
 * candle list. Returns `null` for an empty window rather than sentinel
 * zeros, so callers can't accidentally chart a $0 price floor for a period
 * that simply has no cached candles.
 */
export function computePriceSummary(candles: Candle[]): PriceSummary | null {
  if (candles.length === 0) return null;

  let minClose = candles[0].close;
  let maxClose = candles[0].close;
  let minLow = candles[0].low;
  let maxHigh = candles[0].high;
  let closeSum = 0;

  for (const candle of candles) {
    if (candle.close < minClose) minClose = candle.close;
    if (candle.close > maxClose) maxClose = candle.close;
    if (candle.low < minLow) minLow = candle.low;
    if (candle.high > maxHigh) maxHigh = candle.high;
    closeSum += candle.close;
  }

  return { minClose, maxClose, avgClose: closeSum / candles.length, minLow, maxHigh };
}
