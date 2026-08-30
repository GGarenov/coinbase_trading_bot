import type { TradeDecision } from "@coinbase-trading-bot/shared";
import type { Prisma, PrismaClient } from "@prisma/client";

type MissedFillDecision = Extract<TradeDecision, { kind: "MISSED_FILL" }>;

/**
 * A DB handle that can record a `MissedFill` — either the plain
 * `PrismaClient` singleton, or the transaction client `sessionManager.ts`
 * passes in so a missed fill is recorded atomically alongside the rest of
 * a tick's Order/Fill/Trade/Balance/strategyState writes.
 */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Persists a `MissedFill` row for a grid level that was crossed without a
 * fill (either the stop-limit-with-buffer timed out with no market
 * fallback configured, or the fallback itself wasn't enabled) — feeds the
 * backtest/paper report's "instances of missed fills" metric.
 */
export async function recordMissedFill(db: Db, sessionId: number, decision: MissedFillDecision, occurredAtMs: number): Promise<void> {
  await db.missedFill.create({
    data: {
      sessionId,
      levelPrice: decision.levelPrice,
      side: decision.side,
      reason: decision.reason,
      occurredAt: new Date(occurredAtMs),
    },
  });
}
