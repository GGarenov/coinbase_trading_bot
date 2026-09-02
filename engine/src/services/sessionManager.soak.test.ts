import type { Candle, PortfolioState, PricePoint, TradeDecision } from "@coinbase-trading-bot/shared";
import { DEFAULT_FEE_SCHEDULE, gridStrategy } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { afterAll, describe, expect, it, vi } from "vitest";

// (Proposed, tasks-qa.md Phase 7.2) — an extended "soak test": replays a
// real multi-day slice of historical SOL-USDC ticks, at accelerated speed,
// through the ACTUAL paper-session machinery (`startSession()` + the shared
// `PriceStream` + `handleTick()`'s per-tick DB transaction), the same
// real-time code path a month-long unattended paper session would use —
// deliberately NOT `backtestRunner.ts`'s separate candle-iteration loop,
// since the whole point is to catch drift/leaks specific to the live/paper
// path itself (the `processing` overlap guard, per-tick state persistence,
// PriceStream subscription bookkeeping) rather than re-testing backtesting.
//
// Rather than a hardcoded "golden" expected order/missed-fill count, this
// test derives its own expectation by running an identical, DB-free
// "shadow" grid strategy instance over the exact same candle sequence and
// comparing decision counts to what the real paper-session path actually
// persisted. This is a direct, automated check of the `backend` skill's
// own stated invariant — "Never fork a separate fill-simulation path for
// backtest vs paper — that's how paper and backtest results drift apart" —
// applied here as paper-vs-pure-strategy-logic parity instead. `PriceStream`
// is mocked (same technique as sessionManager.test.ts / Phase 6.1) so the
// "accelerated speed" replay never waits on a real WebSocket tick.

const PRODUCT_ID = "SOL-USDC";
// A real 10-day slice already covered by tasks-qa.md Phase 3's cached
// candle window (2026-08-03..2026-09-02) — this sub-range needs no fresh
// Coinbase fetch. Same grid levels/config as Phase 3's known-active window,
// reused here because it's already confirmed (Phase 3) to produce real
// buys, a sell, and a missed fill over the full month — a flat, inactive
// window would soak-test nothing.
const START = new Date("2026-08-03T00:00:00.000Z").getTime();
const END = new Date("2026-08-13T00:00:00.000Z").getTime();

const GRID_PARAMS = {
  productId: PRODUCT_ID,
  levels: [
    { price: 74, side: "BUY" as const },
    { price: 80, side: "SELL" as const },
    { price: 84, side: "BUY" as const },
    { price: 92, side: "SELL" as const },
    { price: 96, side: "BUY" as const },
    { price: 104, side: "SELL" as const },
  ],
  amountPerLevel: 200,
  stopLimitBufferPct: 0.5,
  marketFallback: { enabled: false, timeoutSeconds: 300 },
};

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
    emit(productId: string, point: PricePoint): void {
      for (const listener of this.listeners.get(productId) ?? []) listener(point);
    }
    get totalListenerCount(): number {
      let total = 0;
      for (const set of this.listeners.values()) total += set.size;
      return total;
    }
  }
  return { PriceStream: FakePriceStream };
});

import { getCachedCandles } from "./priceCandleCache";
import { getRunningSessionIds, priceStream, startSession, stopSession } from "./sessionManager";

async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 25));
}

describe("Extended soak test — multi-day accelerated replay through the real paper-session path (Phase 7.2)", () => {
  it(
    "matches a DB-free shadow strategy instance's decisions, with no listener leak and bounded strategyState size",
    async () => {
      const candles: Candle[] = await getCachedCandles(PRODUCT_ID, "ONE_HOUR", START, END);
      expect(candles.length).toBeGreaterThan(48); // sanity: this really is a multi-day slice, not an empty/tiny fetch

      // --- Shadow run: pure strategy logic, no DB, no session machinery at all ---
      const shadow = gridStrategy.create(GRID_PARAMS, START);
      const dummyPortfolio: PortfolioState = { quoteBalance: 0, baseBalance: 0 };
      let shadowOrderDecisions = 0;
      let shadowMissedFillDecisions = 0;
      for (const candle of candles) {
        const decisions: TradeDecision[] = shadow.onPrice({ price: candle.close, timestamp: candle.openTime }, dummyPortfolio);
        for (const d of decisions) {
          if (d.kind === "ORDER") shadowOrderDecisions++;
          else shadowMissedFillDecisions++;
        }
      }

      // --- Real run: through the actual paper-session path ---
      const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "grid" } });
      const strategyConfig = await prisma.strategyConfig.create({
        data: { strategyId: strategy.id, name: "phase7.2-soak-test (ephemeral)", params: GRID_PARAMS },
      });
      const session = await prisma.session.create({
        data: {
          mode: "PAPER",
          status: "PENDING",
          strategyConfigId: strategyConfig.id,
          productId: PRODUCT_ID,
          initialQuoteBalance: 5000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same Json cast sessionFactory.ts uses
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startedAt: new Date(START),
        },
      });

      const heapBefore = process.memoryUsage().heapUsed;
      const strategyStateSizes: number[] = [];

      try {
        await startSession(session.id);
        expect(getRunningSessionIds()).toContain(session.id);

        for (let i = 0; i < candles.length; i++) {
          const candle = candles[i];
          (priceStream as unknown as { emit: (p: string, pt: PricePoint) => void }).emit(PRODUCT_ID, {
            price: candle.close,
            timestamp: candle.openTime,
          });
          await flushAsync();

          if (i < 5 || i % 50 === 0) {
            const row = await prisma.session.findUniqueOrThrow({ where: { id: session.id }, select: { strategyState: true } });
            strategyStateSizes.push(JSON.stringify(row.strategyState).length);
          }
        }

        // Listener bookkeeping: exactly one live listener for this product throughout — no
        // accumulation from repeated ticks (each tick reuses the same subscription, never re-subscribes).
        expect((priceStream as unknown as { totalListenerCount: number }).totalListenerCount).toBe(1);

        // strategyState is a fixed-shape snapshot (grid's `slots` array length never changes after
        // creation) — its serialized size should stay essentially constant across ~10 days of
        // ticks, not grow unboundedly (the specific class of "state drift" this test guards against).
        const minSize = Math.min(...strategyStateSizes);
        const maxSize = Math.max(...strategyStateSizes);
        expect(maxSize - minSize).toBeLessThan(50); // small slack for number-of-digits changes in prices/quantities, not growth

        // The actual parity check: the real paper-session path, driven through the full session-
        // manager/DB machinery, must agree with the pure shadow strategy fed the identical candles.
        const [orderCount, missedFillCount] = await Promise.all([
          prisma.order.count({ where: { sessionId: session.id } }),
          prisma.missedFill.count({ where: { sessionId: session.id } }),
        ]);
        expect(orderCount).toBe(shadowOrderDecisions);
        expect(missedFillCount).toBe(shadowMissedFillDecisions);
        // Not a flat/inactive run — this window is known (Phase 3) to be genuinely active.
        expect(orderCount + missedFillCount).toBeGreaterThan(0);

        // strategyState round-tripped as a well-formed snapshot, not corrupted — grid's `slots`
        // array must still have exactly one entry per configured BUY level (3), never having grown
        // or shrunk across ~10 days of ticks.
        const finalSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
        const finalState = finalSession.strategyState as { slots: unknown[] } | null;
        expect(finalState?.slots).toHaveLength(3);

        // Portfolio stayed numerically sane throughout — no NaN/Infinity drift from repeated
        // fee/decimal arithmetic across many ticks.
        const finalBalance = await prisma.balance.findFirst({ where: { sessionId: session.id }, orderBy: { timestamp: "desc" } });
        if (finalBalance) {
          expect(Number.isFinite(Number(finalBalance.quoteBalance))).toBe(true);
          expect(Number.isFinite(Number(finalBalance.baseBalance))).toBe(true);
          expect(Number(finalBalance.quoteBalance)).toBeGreaterThan(0);
        }

        // Best-effort gross-leak guard — soft on purpose (GC timing in a short-lived test process is
        // inherently noisy without `--expose-gc`), but a truly pathological per-tick leak across
        // ~240 ticks would still blow well past this.
        const heapAfter = process.memoryUsage().heapUsed;
        const heapGrowthMb = (heapAfter - heapBefore) / (1024 * 1024);
        expect(heapGrowthMb).toBeLessThan(100);
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
    },
    60_000, // ~240 ticks * 25ms flush + real candle fetch — generous but bounded, unlike an unattended real run
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
