/** A single observed price, from a historical candle (backtest) or a live tick (paper/live trading). */
export interface PricePoint {
  price: number;
  /** ms epoch */
  timestamp: number;
}

/** One OHLCV bar, matching the shape of the `PriceCandleCache` Prisma model. */
export interface Candle {
  /** ms epoch of the bar's open time. */
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Coinbase Advanced Trade's candle granularity values. Restricted to the
 * three timeframes this project actually offers for indicator strategies —
 * 4h was explicitly dropped rather than synthesized from 1h candles.
 */
export type Granularity = "ONE_HOUR" | "SIX_HOUR" | "ONE_DAY";

/** What a strategy is allowed to know about the account it's trading for. */
export interface PortfolioState {
  /** Quote currency balance (e.g. USDC), simulated or real depending on mode. */
  quoteBalance: number;
  /** Base currency balance (e.g. SOL), simulated or real depending on mode. */
  baseBalance: number;
}
