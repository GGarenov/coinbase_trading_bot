import type { PricePoint } from "@coinbase-trading-bot/shared";
import { DEFAULT_FEE_SCHEDULE } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getRunningSessionIds, getSessionRuntimeSnapshot, priceStream, resumeRunningSessions, stopSession } from "./sessionManager";

// (Proposed, tasks-qa.md Phase 6.1) — an AUTOMATED version of the manual
// "kill the engine, restart it, confirm state survived" check from Phase 2.2
// (already verified once by hand against a real running engine). This test
// exercises the exact same `resumeRunningSessions()` function directly,
// against a real fixture row in the project's real dev DB (`data/bot.db`) —
// there's no isolated test-DB harness in this project yet, so this follows
// the same "create real ephemeral rows, clean them up after" convention
// every `engine/scripts/smoke-test-*.ts` script already uses, just written
// as a Vitest test instead of a standalone script.
//
// The shared `PriceStream` is mocked so this test never opens a real
// WebSocket to Coinbase — a crash-recovery correctness test should be fast
// and deterministic, not dependent on when a real tick happens to arrive.

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-01-01T00:00:00.000Z").getTime();

type Listener = (point: PricePoint) => void;

vi.mock("../exchange/coinbase/stream", () => {
  class FakePriceStream {
    private listeners = new Map<string, Set<Listener>>();
    subscribe(productId: string, listener: Listener): () => void {
      let set = this.listeners.get(productId);
      if (!set) {
        set = new Set();
        this.listeners.set(productId, set);
      }
      set.add(listener);
      return () => set?.delete(listener);
    }
    /** Test-only hook: simulates a real tick arriving for `productId`, without any real networking. */
    emit(productId: string, point: PricePoint): void {
      for (const listener of this.listeners.get(productId) ?? []) listener(point);
    }
  }
  return { PriceStream: FakePriceStream };
});

// vi.mock above is hoisted before the static import at the top of this file, so
// sessionManager.ts's own `export const priceStream = new PriceStream()` already uses the fake.
const emitTick = (productId: string, point: PricePoint) => (priceStream as unknown as { emit: (p: string, pt: PricePoint) => void }).emit(productId, point);

async function flushAsync(): Promise<void> {
  // handleTick's own async work (a Prisma transaction) isn't awaited by the fire-and-forget
  // `void handleTick(...)` call inside startSession()'s subscribe callback — give it a tick to finish.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("resumeRunningSessions() — crash-recovery correctness (Phase 6.1)", () => {
  it("reconstructs portfolio state from the latest Balance row and the strategy's own strategyState — not a reset to initial values", async () => {
    const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "dca" } });
    const strategyConfig = await prisma.strategyConfig.create({
      data: {
        strategyId: strategy.id,
        name: "phase6.1-crash-recovery (ephemeral)",
        params: { productId: "SOL-USDC", amountPerBuy: 10, interval: "daily", durationDays: 10 },
      },
    });

    // Fixture simulates a session that was RUNNING before an engine crash: the day-0 DCA buy
    // already happened (one FILLED Order/Fill, one Balance row reflecting the post-buy portfolio),
    // and `strategyState.nextBuyTime` has already advanced one day past `startedAt` — exactly what
    // the real DcaInstance's state looks like after its first buy (see dca.ts).
    const session = await prisma.session.create({
      data: {
        mode: "PAPER",
        status: "RUNNING",
        strategyConfigId: strategyConfig.id,
        productId: "SOL-USDC",
        initialQuoteBalance: 1000,
        initialBaseBalance: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FeeSchedule is a plain {makerRate,takerRate} object; Prisma's generated Json input type just doesn't structurally recognize it (same cast sessionFactory.ts itself uses)
        feeSchedule: DEFAULT_FEE_SCHEDULE as any,
        startedAt: new Date(T0),
        strategyState: { nextBuyTime: T0 + DAY_MS, endTime: T0 + 10 * DAY_MS },
      },
    });

    const order = await prisma.order.create({
      data: { sessionId: session.id, side: "BUY", type: "MARKET", price: 100, size: 0.1, status: "FILLED", filledAt: new Date(T0) },
    });
    await prisma.fill.create({
      data: { orderId: order.id, price: 100, size: 0.1, fee: 0.12, feeRate: 0.012, liquidity: "TAKER", timestamp: new Date(T0) },
    });
    await prisma.balance.create({
      data: { sessionId: session.id, timestamp: new Date(T0), quoteBalance: 989.88, baseBalance: 0.1, equity: 999.88 },
    });

    try {
      await resumeRunningSessions();

      expect(getRunningSessionIds()).toContain(session.id);

      // The key assertion: portfolio state came from the fixture's Balance row (989.88 / 0.1), not
      // reset to the session's initialQuoteBalance/initialBaseBalance (1000 / 0).
      const snapshotAfterResume = getSessionRuntimeSnapshot(session.id);
      expect(snapshotAfterResume).toMatchObject({ quoteBalance: 989.88, baseBalance: 0.1 });

      // A tick arrives well before the restored nextBuyTime (T0 + 1 day) — if strategyState had
      // instead been silently reset (e.g. a bug re-creating a fresh DcaInstance without restoring
      // the snapshot), nextBuyTime would be back at T0 and this tick (well after T0) would
      // incorrectly fire a second, premature buy.
      emitTick("SOL-USDC", { price: 105, timestamp: T0 + 12 * 60 * 60 * 1000 });
      await flushAsync();

      expect(getSessionRuntimeSnapshot(session.id)?.lastPrice).toBe(105);
      const ordersAfterEarlyTick = await prisma.order.count({ where: { sessionId: session.id } });
      expect(ordersAfterEarlyTick).toBe(1); // still just the pre-existing day-0 buy — no premature re-buy

      // A tick arrives just past the restored nextBuyTime — the schedule should still fire exactly
      // when it's actually due, proving the restored state isn't just frozen/stuck either.
      emitTick("SOL-USDC", { price: 106, timestamp: T0 + DAY_MS + 1000 });
      await flushAsync();

      const ordersAfterDueTick = await prisma.order.count({ where: { sessionId: session.id } });
      expect(ordersAfterDueTick).toBe(2); // the correctly-scheduled day-1 buy fired
    } finally {
      await stopSession(session.id).catch(() => {});
      await prisma.trade.deleteMany({ where: { sessionId: session.id } });
      await prisma.fill.deleteMany({ where: { order: { sessionId: session.id } } });
      await prisma.missedFill.deleteMany({ where: { sessionId: session.id } });
      await prisma.balance.deleteMany({ where: { sessionId: session.id } });
      await prisma.order.deleteMany({ where: { sessionId: session.id } });
      await prisma.session.delete({ where: { id: session.id } });
      await prisma.strategyConfig.delete({ where: { id: strategyConfig.id } });
    }
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
