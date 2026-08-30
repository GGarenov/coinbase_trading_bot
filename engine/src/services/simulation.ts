import type { FeeSchedule, Liquidity, PortfolioState, TradeDecision } from "@coinbase-trading-bot/shared";
import { classifyLiquidity, resolveFeeRate } from "@coinbase-trading-bot/shared";

/**
 * Shared fill-simulation core for BACKTEST and PAPER sessions — LIVE
 * sessions go through `exchange/coinbase/orderExecutor.ts` instead, against
 * the real exchange. Deliberately mirrors `orderExecutor.ts`'s fill-price
 * assumption so paper and live behave identically wherever real order-fill
 * data isn't available yet: a LIMIT/STOP_LIMIT decision is assumed filled
 * at its intended level price (`decision.levelPrice`, if set — grid always
 * sets this; DCA/RSI/MA never do) or the current reference price if none is
 * set; a MARKET decision is assumed filled at the reference price. Neither
 * models slippage or partial fills — a documented first cut, same as
 * `orderExecutor.ts`, to be revisited once real order-status tracking
 * exists for live trading.
 */

export type OrderDecision = Extract<TradeDecision, { kind: "ORDER" }>;

export interface SimulatedFill {
  price: number;
  size: number;
  fee: number;
  feeRate: number;
  liquidity: Liquidity;
}

function intendedFillPrice(decision: OrderDecision, referencePrice: number): number {
  if (decision.orderType === "MARKET") return referencePrice;
  return decision.levelPrice ?? referencePrice;
}

/** Turns a strategy's `TradeDecision` into a simulated fill against the given reference price — pure, no DB, no I/O. */
export function simulateFill(decision: OrderDecision, referencePrice: number, feeSchedule: FeeSchedule): SimulatedFill {
  const price = intendedFillPrice(decision, referencePrice);
  const size = decision.side === "BUY" ? decision.quoteAmount / price : decision.quantity;
  const notional = price * size;
  const liquidity = classifyLiquidity(decision.orderType);
  const feeRate = resolveFeeRate(feeSchedule, decision.orderType);
  return { price, size, fee: notional * feeRate, feeRate, liquidity };
}

/**
 * Applies a fill (simulated or real) to a portfolio's balances — pure, no
 * DB. A BUY spends quote currency (notional + fee) and gains base currency;
 * a SELL gains quote currency (notional - fee) and spends base currency.
 */
export function applyFillToPortfolio(
  portfolio: PortfolioState,
  side: "BUY" | "SELL",
  fill: { price: number; size: number; fee: number },
): PortfolioState {
  const notional = fill.price * fill.size;
  if (side === "BUY") {
    return {
      quoteBalance: portfolio.quoteBalance - notional - fill.fee,
      baseBalance: portfolio.baseBalance + fill.size,
    };
  }
  return {
    quoteBalance: portfolio.quoteBalance + notional - fill.fee,
    baseBalance: portfolio.baseBalance - fill.size,
  };
}
