import type { z } from "zod";
import type { PortfolioState, PricePoint } from "../types";

/**
 * Hints the order/fill circumstance a decision assumes, so the fill
 * simulator (and later, the real Coinbase order executor) can classify
 * maker vs. taker correctly:
 *  - LIMIT / STOP_LIMIT: a resting order that gets hit — maker.
 *  - MARKET: always taker, whether it's a genuine market-following
 *    strategy (RSI/MA/DCA) or a grid level's opt-in timeout fallback.
 * Mirrors the Prisma `OrderType` enum.
 */
export type OrderTypeHint = "LIMIT" | "MARKET" | "STOP_LIMIT";

/**
 * What a strategy decided to do on one price point. `kind: "ORDER"` is an
 * actual trade intent; `kind: "MISSED_FILL"` is purely informational — it
 * carries no economic effect and exists so `missedFillTracker.ts` can
 * persist a `MissedFill` row for reporting (backtest's "instances of
 * missed fills" metric).
 *
 * A sell's `costBasis` is REQUIRED, not optional. The earlier Binance-based
 * iteration of this project made it optional and fell back to FIFO matching
 * across a session's fills when absent — which silently mislabeled
 * profitable grid round-trips as losses, because a grid sell closes a
 * *specific* buy (or lot), not necessarily the oldest one in the session.
 * Every strategy that can sell must know and report exactly what it's
 * closing; there is no FIFO fallback in this project.
 */
export type TradeDecision =
  | {
      kind: "ORDER";
      side: "BUY";
      orderType: OrderTypeHint;
      /** Quote currency to spend, e.g. 25 (USDC). */
      quoteAmount: number;
      /** Which configured grid level this belongs to, if any. */
      levelPrice?: number;
    }
  | {
      kind: "ORDER";
      side: "SELL";
      orderType: OrderTypeHint;
      /** Base currency quantity to sell, e.g. 0.26 (SOL). */
      quantity: number;
      /** What was paid (in quote currency) for the position being closed. */
      costBasis: number;
      /** Which configured grid level this belongs to, if any. */
      levelPrice?: number;
    }
  | {
      kind: "MISSED_FILL";
      side: "BUY" | "SELL";
      levelPrice: number;
      reason: string;
    };

/**
 * A live strategy with internal state (e.g. "when is my next DCA buy",
 * "which grid levels am I holding"). Deliberately pure: no DB, no HTTP, no
 * system clock — the caller supplies time (via `PricePoint.timestamp`) and
 * prices. That purity is what lets the same implementation drive both
 * backtesting (fed historical candles) and paper/live trading (fed
 * real-time ticks) without the two ever behaving differently.
 */
export interface StrategyInstance {
  /** Called once per price point, in chronological order. */
  onPrice(point: PricePoint, portfolio: PortfolioState): TradeDecision[];
  /** Serializable snapshot, persisted so sessions survive engine restarts. */
  getState(): unknown;
  /** Restore a snapshot produced by getState(). */
  setState(state: unknown): void;
}

export interface StrategyDefinition<P = unknown> {
  /** Matches the `slug` column of the `Strategy` catalog table. */
  slug: string;
  /** Validates user-supplied params before they ever reach the engine or the DB. */
  paramsSchema: z.ZodType<P>;
  /**
   * Indicator strategies (MA crossover, RSI) need history before their
   * first real decision. When set, the caller feeds this many extra
   * candles from before the session start (decisions during warm-up are
   * discarded), so indicators are already primed at the real start.
   */
  warmupCandles?: number | ((params: P) => number);
  /**
   * @param startTimeMs when the strategy's clock starts: the first candle
   * of a backtest, or the moment a paper/live session is created.
   */
  create(params: P, startTimeMs: number): StrategyInstance;
}
