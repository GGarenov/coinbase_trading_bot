import type { PortfolioState } from "@coinbase-trading-bot/shared";
import { isKillSwitchEngaged } from "./killSwitch";
import type { OrderDecision } from "./simulation";

export interface LiveSafetyLimits {
  /** Quote currency; null = no cap. A single BUY decision above this is rejected. */
  maxSpendPerOrder: number | null;
  /** Base currency; null = no cap. A BUY that would push baseBalance above this is rejected. */
  maxPositionSize: number | null;
}

export type SafetyCheckResult = { allowed: true } | { allowed: false; reason: string };

/**
 * The gate every LIVE-mode `TradeDecision` passes through before it's ever
 * sent to the real exchange (called from `sessionManager.ts`'s
 * `processDecisions`, only when `ctx.mode === "LIVE"`). Checks, in order:
 *  1. `LIVE_TRADING_ENABLED` is set on this process.
 *  2. The global kill switch (`killSwitch.ts`) isn't engaged.
 *  3. The decision doesn't exceed this session's `maxSpendPerOrder`.
 *  4. The decision doesn't push the position past `maxPositionSize`.
 *
 * Only BUY decisions are capped by (3)/(4) — a SELL reduces exposure, which
 * these caps exist to limit, not increase. A rejection here is NOT silently
 * dropped by the caller: `sessionManager.ts` persists it as an `Order` row
 * with `status: "REJECTED"` and this function's `reason`, so a full audit
 * trail exists even for decisions that never reached the exchange.
 *
 * `executeOrder()` (`exchange/coinbase/orderExecutor.ts`) independently
 * re-checks (1) and (2) itself — defense in depth for the two checks that
 * don't depend on session-specific data, in case anything ever calls it
 * without going through this gate first.
 */
export async function checkLiveSafety(
  decision: OrderDecision,
  portfolio: PortfolioState,
  limits: LiveSafetyLimits,
  referencePrice: number,
): Promise<SafetyCheckResult> {
  if (process.env.LIVE_TRADING_ENABLED !== "true") {
    return { allowed: false, reason: 'LIVE_TRADING_ENABLED is not set to "true" on this process' };
  }
  if (await isKillSwitchEngaged()) {
    return { allowed: false, reason: "the global kill switch is engaged" };
  }

  if (decision.side === "BUY") {
    if (limits.maxSpendPerOrder !== null && decision.quoteAmount > limits.maxSpendPerOrder) {
      return {
        allowed: false,
        reason: `BUY quoteAmount ${decision.quoteAmount} exceeds this session's maxSpendPerOrder ${limits.maxSpendPerOrder}`,
      };
    }
    if (limits.maxPositionSize !== null) {
      // A pre-flight estimate — orderExecutor.ts does the real, exact sizing once an order is
      // actually allowed through. Good enough to gate on; not meant to be the final recorded size.
      const estimatedSize = decision.quoteAmount / referencePrice;
      const resultingPosition = portfolio.baseBalance + estimatedSize;
      if (resultingPosition > limits.maxPositionSize) {
        return {
          allowed: false,
          reason: `estimated resulting position ${resultingPosition.toFixed(8)} would exceed this session's maxPositionSize ${limits.maxPositionSize}`,
        };
      }
    }
  }

  return { allowed: true };
}
