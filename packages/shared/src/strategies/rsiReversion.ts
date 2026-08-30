import { z } from "zod";
import type { PortfolioState, PricePoint } from "../types";
import { rsiFromCloses } from "./indicators";
import type { StrategyDefinition, StrategyInstance, TradeDecision } from "./types";

export const rsiReversionParamsSchema = z
  .object({
    productId: z.string().min(1),
    /** RSI lookback, in hourly samples. 14 is the textbook default. */
    rsiPeriod: z.number().int().min(2).max(100),
    /** Buy when RSI drops below this ("everyone has been selling"). */
    oversold: z.number().min(1).max(50),
    /** Sell when RSI rises above this ("everyone has been buying"). */
    overbought: z.number().min(50).max(99),
    /** Quote currency spent when a buy signal fires. */
    amountPerEntry: z.number().positive(),
  })
  .refine((p) => p.overbought > p.oversold, {
    message: "overbought must be greater than oversold",
  });

export type RsiReversionParams = z.infer<typeof rsiReversionParamsSchema>;

/** Samples hourly, same as MA Crossover's ONE_HOUR granularity. */
const SAMPLE_MS = 60 * 60 * 1000;

/**
 * Keeping 5x the period of closes makes the exponentially-smoothed RSI value
 * effectively identical to one computed over infinite history, while keeping
 * the state snapshot small and the calculation deterministic after a resume.
 */
const BUFFER_FACTOR = 5;

interface RsiState {
  closes: number[];
  lastSampleTime: number | null;
  /** Base quantity currently held, null when out of the market. */
  holdingQty: number | null;
}

/**
 * RSI Mean Reversion: buy when the market looks oversold (RSI below the
 * threshold), sell when it looks overbought. Bets that extremes snap back to
 * the middle. One position at a time. Buys/sells are market orders (taker) —
 * same reasoning as MA Crossover.
 *
 * Ported and adapted from the earlier Binance-based iteration of this
 * project (there registered as slug `rsi-reversion`; renamed to
 * `rsi-mean-reversion` here to match this project's naming).
 *
 * Known failure mode, observed on real historical data by the old project:
 * RSI mean reversion can buy repeatedly into a sustained downtrend ("the
 * falling knife") since low RSI alone doesn't distinguish "oversold, about
 * to bounce" from "still falling." This is a property of the strategy, not
 * a bug — worth remembering when evaluating paper-trading results.
 */
class RsiReversionInstance implements StrategyInstance {
  private state: RsiState = { closes: [], lastSampleTime: null, holdingQty: null };

  constructor(private readonly params: RsiReversionParams) {}

  onPrice(point: PricePoint, _portfolio: PortfolioState): TradeDecision[] {
    const s = this.state;
    if (s.lastSampleTime !== null && point.timestamp < s.lastSampleTime + SAMPLE_MS) {
      return [];
    }
    s.lastSampleTime = point.timestamp;

    const cap = this.params.rsiPeriod * BUFFER_FACTOR;
    s.closes.push(point.price);
    if (s.closes.length > cap) {
      s.closes.splice(0, s.closes.length - cap);
    }

    const rsi = rsiFromCloses(s.closes, this.params.rsiPeriod);
    if (rsi === null) return [];

    const decisions: TradeDecision[] = [];

    if (rsi < this.params.oversold && s.holdingQty === null) {
      decisions.push({ kind: "ORDER", side: "BUY", orderType: "MARKET", quoteAmount: this.params.amountPerEntry });
      s.holdingQty = this.params.amountPerEntry / point.price;
    } else if (rsi > this.params.overbought && s.holdingQty !== null) {
      decisions.push({
        kind: "ORDER",
        side: "SELL",
        orderType: "MARKET",
        quantity: s.holdingQty,
        costBasis: this.params.amountPerEntry,
      });
      s.holdingQty = null;
    }

    return decisions;
  }

  getState(): RsiState {
    return { ...this.state, closes: [...this.state.closes] };
  }

  setState(state: unknown): void {
    this.state = state as RsiState;
  }
}

export const rsiReversionStrategy: StrategyDefinition<RsiReversionParams> = {
  slug: "rsi-mean-reversion",
  paramsSchema: rsiReversionParamsSchema,
  warmupCandles: (params) => params.rsiPeriod * BUFFER_FACTOR,
  create: (params) => new RsiReversionInstance(params),
};
