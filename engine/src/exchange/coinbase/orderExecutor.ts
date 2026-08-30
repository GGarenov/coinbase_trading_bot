import type { OrderTypeHint, TradeDecision } from "@coinbase-trading-bot/shared";
import { classifyLiquidity, type FeeSchedule, type Liquidity, resolveFeeRate } from "@coinbase-trading-bot/shared";
import type { ProductInfo } from "./rest";
import { getTradingClient } from "./tradingClient";

/**
 * Bridges a strategy's `TradeDecision` to a real Coinbase order, and shapes
 * the result identically to a simulated fill so downstream bookkeeping
 * (once `simulation.ts`/the session manager exist) doesn't need to know
 * whether a fill came from here or from paper-trading simulation.
 *
 * Fill-price assumption (first cut, to revisit once the session manager
 * does real order tracking): a MARKET order is assumed filled at Coinbase's
 * reported average price (falling back to the decision's reference price
 * if the response doesn't include one); a LIMIT/STOP_LIMIT order is
 * assumed filled at its intended limit price. Neither assumption polls
 * Coinbase for the order's actual eventual status — that's the session
 * manager's job, not this bridging function's.
 */
export interface LiveFill {
  exchangeOrderId: string;
  price: number;
  size: number;
  fee: number;
  feeRate: number;
  liquidity: Liquidity;
  timestamp: number;
}

export class OrderRejectedError extends Error {
  constructor(reason: string | undefined) {
    super(`Coinbase rejected the order: ${reason ?? "unknown reason"}`);
  }
}

/** Rounds DOWN to the nearest increment — never up, so we never oversell/overspend past what was intended. */
function roundDownToIncrement(value: number, increment: number): number {
  if (increment <= 0) return value;
  return Math.floor(value / increment) * increment;
}

function intendedLimitPrice(decision: Extract<TradeDecision, { kind: "ORDER" }>, referencePrice: number): number {
  // Grid decisions tag the level they belong to; that IS the intended limit price.
  // Non-grid strategies (DCA/RSI/MA) only ever emit MARKET decisions, so this
  // path is grid-specific in practice.
  return decision.levelPrice ?? referencePrice;
}

export async function executeOrder(
  decision: Extract<TradeDecision, { kind: "ORDER" }>,
  referencePrice: number,
  productInfo: ProductInfo,
  feeSchedule: FeeSchedule,
): Promise<LiveFill> {
  const client = getTradingClient();
  if (!client) {
    throw new Error("executeOrder called with no CDP credentials configured — this path is live-trading only");
  }

  const isMarket = decision.orderType === "MARKET";
  const limitPrice = isMarket ? undefined : intendedLimitPrice(decision, referencePrice);

  let baseSize: number;
  let quoteSize: string | undefined;

  if (decision.side === "BUY") {
    if (isMarket) {
      // Market buys are sized in quote currency; Coinbase computes the base amount.
      quoteSize = roundDownToIncrement(decision.quoteAmount, productInfo.quoteIncrement).toString();
      baseSize = decision.quoteAmount / referencePrice; // best-effort estimate for the returned LiveFill's `size`
    } else {
      baseSize = roundDownToIncrement(decision.quoteAmount / limitPrice!, productInfo.baseIncrement);
    }
  } else {
    baseSize = roundDownToIncrement(decision.quantity, productInfo.baseIncrement);
  }

  if (baseSize < productInfo.baseMinSize) {
    throw new Error(
      `Order size ${baseSize} is below ${productInfo.productId}'s baseMinSize ${productInfo.baseMinSize} after rounding down to the increment`,
    );
  }

  const clientOrderId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const result = await client.placeOrder({
    productId: productInfo.productId,
    side: decision.side,
    clientOrderId,
    limitPrice: limitPrice?.toString(),
    baseSize: decision.side === "SELL" || !isMarket ? baseSize.toString() : undefined,
    quoteSize,
    stopPrice: decision.orderType === "STOP_LIMIT" ? limitPrice?.toString() : undefined,
  });

  if (!result.success) {
    throw new OrderRejectedError(result.failureReason);
  }

  const fillPrice = limitPrice ?? referencePrice;
  const liquidity = classifyLiquidity(decision.orderType as OrderTypeHint);
  const feeRate = resolveFeeRate(feeSchedule, decision.orderType as OrderTypeHint);
  const notional = baseSize * fillPrice;

  return {
    exchangeOrderId: result.orderId,
    price: fillPrice,
    size: baseSize,
    fee: notional * feeRate,
    feeRate,
    liquidity,
    timestamp: Date.now(),
  };
}
