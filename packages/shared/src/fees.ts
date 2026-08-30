import type { OrderTypeHint } from "./strategies/types";

/** Which side of the trade actually provided or took liquidity — mirrors the Prisma `Liquidity` enum. */
export type Liquidity = "MAKER" | "TAKER";

export interface FeeSchedule {
  /** e.g. 0.006 for 0.60% */
  makerRate: number;
  /** e.g. 0.012 for 1.20% */
  takerRate: number;
}

/**
 * Coinbase's lowest-volume ("Advanced 1") tier as of PLAN.md's writing.
 * This is a starting default, not a hardcoded truth — a session's actual
 * `feeSchedule` is snapshotted from this (or an override) at creation time
 * and never re-read live, so a later change to your account's volume tier
 * doesn't retroactively alter an in-progress or historical session's fees.
 */
export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  makerRate: 0.006,
  takerRate: 0.012,
};

/**
 * Determines whether a fill counts as maker or taker liquidity from the
 * order type a `TradeDecision` carried:
 *  - LIMIT / STOP_LIMIT: a resting order that got hit — maker.
 *  - MARKET: always taker, whether it's a genuinely market-following
 *    strategy (RSI/MA/DCA) or a grid level's opt-in timeout fallback.
 */
export function classifyLiquidity(orderType: OrderTypeHint): Liquidity {
  return orderType === "MARKET" ? "TAKER" : "MAKER";
}

/** Resolves the fee rate that applies to a fill, given the session's snapshotted schedule. */
export function resolveFeeRate(schedule: FeeSchedule, orderType: OrderTypeHint): number {
  return classifyLiquidity(orderType) === "MAKER" ? schedule.makerRate : schedule.takerRate;
}
