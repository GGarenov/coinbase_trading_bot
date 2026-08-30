import { z } from "zod";
import type { Granularity, PortfolioState, PricePoint } from "../types";
import { sma } from "./indicators";
import type { StrategyDefinition, StrategyInstance, TradeDecision } from "./types";

/** ms per sample, for each of the three granularities this project supports (no synthetic 4h). */
const SAMPLE_MS_BY_GRANULARITY: Record<Granularity, number> = {
  ONE_HOUR: 60 * 60 * 1000,
  SIX_HOUR: 6 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
};

export const maCrossoverParamsSchema = z
  .object({
    productId: z.string().min(1),
    granularity: z.enum(["ONE_HOUR", "SIX_HOUR", "ONE_DAY"]),
    /** Fast average, reacts quickly. Default 9 per PLAN.md. */
    fastPeriod: z.number().int().min(2).max(200),
    /** Slow average, the underlying trend. Default 21 per PLAN.md. */
    slowPeriod: z.number().int().min(3).max(500),
    /** Quote currency spent when a buy signal fires. */
    amountPerEntry: z.number().positive(),
  })
  .refine((p) => p.slowPeriod > p.fastPeriod, {
    message: "slowPeriod must be greater than fastPeriod",
  });

export type MaCrossoverParams = z.infer<typeof maCrossoverParamsSchema>;

interface MaState {
  /** Closes at the configured granularity, capped at slowPeriod (all the SMAs ever need). */
  closes: number[];
  lastSampleTime: number | null;
  /** Base quantity currently held, null when out of the market. */
  holdingQty: number | null;
  /** Was the fast SMA above the slow SMA at the previous sample? */
  prevFastAboveSlow: boolean | null;
}

/**
 * Moving Average Crossover (trend following): golden cross (fast MA rises
 * above slow MA) buys, death cross (fast MA falls below slow MA) sells
 * everything. One position at a time. Buys/sells are treated as market
 * orders (taker) — the signal is "the trend just turned," not a specific
 * resting price.
 *
 * Ported and adapted from the earlier Binance-based iteration of this
 * project: renamed shortPeriod/longPeriod -> fastPeriod/slowPeriod to match
 * this project's naming, and replaced the old hardcoded hourly sampling
 * with a configurable `granularity` (1h/6h/1d — 4h was explicitly dropped
 * rather than synthesized from 1h candles).
 */
class MaCrossoverInstance implements StrategyInstance {
  private state: MaState = {
    closes: [],
    lastSampleTime: null,
    holdingQty: null,
    prevFastAboveSlow: null,
  };

  private readonly sampleMs: number;

  constructor(private readonly params: MaCrossoverParams) {
    this.sampleMs = SAMPLE_MS_BY_GRANULARITY[params.granularity];
  }

  onPrice(point: PricePoint, _portfolio: PortfolioState): TradeDecision[] {
    const s = this.state;
    if (s.lastSampleTime !== null && point.timestamp < s.lastSampleTime + this.sampleMs) {
      return [];
    }
    s.lastSampleTime = point.timestamp;

    s.closes.push(point.price);
    if (s.closes.length > this.params.slowPeriod) {
      s.closes.splice(0, s.closes.length - this.params.slowPeriod);
    }

    const fastSma = sma(s.closes, this.params.fastPeriod);
    const slowSma = sma(s.closes, this.params.slowPeriod);
    if (fastSma === null || slowSma === null) return [];

    const above = fastSma > slowSma;
    const decisions: TradeDecision[] = [];

    // Trade on the *change* of the relationship, not the relationship itself —
    // otherwise we'd buy on every sample of an uptrend.
    if (s.prevFastAboveSlow !== null) {
      if (above && !s.prevFastAboveSlow && s.holdingQty === null) {
        decisions.push({ kind: "ORDER", side: "BUY", orderType: "MARKET", quoteAmount: this.params.amountPerEntry });
        s.holdingQty = this.params.amountPerEntry / point.price;
      } else if (!above && s.prevFastAboveSlow && s.holdingQty !== null) {
        decisions.push({
          kind: "ORDER",
          side: "SELL",
          orderType: "MARKET",
          quantity: s.holdingQty,
          costBasis: this.params.amountPerEntry,
        });
        s.holdingQty = null;
      }
    }

    s.prevFastAboveSlow = above;
    return decisions;
  }

  getState(): MaState {
    return { ...this.state, closes: [...this.state.closes] };
  }

  setState(state: unknown): void {
    this.state = state as MaState;
  }
}

export const maCrossoverStrategy: StrategyDefinition<MaCrossoverParams> = {
  slug: "ma-crossover",
  paramsSchema: maCrossoverParamsSchema,
  // +1 so the crossover direction is already known at the first real sample.
  warmupCandles: (params) => params.slowPeriod + 1,
  create: (params) => new MaCrossoverInstance(params),
};
