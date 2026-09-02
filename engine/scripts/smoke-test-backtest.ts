/**
 * Manual smoke test for services/backtestRunner.ts. Two scenarios:
 *
 * 1. DCA over the last 3 days of live SOL-USDC hourly candles (fetched
 *    fresh from Coinbase, no caching yet — see backtestRunner.ts's scope
 *    note) — "dca" (daily, 3-day duration) is guaranteed to trade multiple
 *    times regardless of what the actual price did, so this checks basic
 *    Order/Fill/resultsSummary wiring.
 * 2. Grid over a FIXED historical window (2026-08-03..2026-09-02,
 *    deliberately hardcoded, not "last N days" — Coinbase's historical
 *    candles for an already-past date range never change, so this is a
 *    reproducible regression fixture, unlike scenario 1's rolling window)
 *    with levels tuned against that window's real price action (fetched
 *    and eyeballed once while building this test) to guarantee a completed
 *    BUY-then-SELL round trip AND a missed fill. This guards a real bug
 *    (found via tasks-qa.md's Phase 3, fixed 2026-09-02): sessionManager.ts
 *    used to look up the BUY order a grid SELL closes by `levelPrice`
 *    (which grid sets to the SELL's own trigger level, not the BUY level
 *    being closed), so the lookup never matched and no `Trade` row was
 *    ever created for a grid round trip — win rate/profit factor/round
 *    trip count silently stayed null/zero for every grid backtest and
 *    paper session in this project's history. Neither this scenario nor
 *    scenario 1 (DCA never triggers this code path — no per-level
 *    identity to look up) had ever exercised it before.
 */
import { prisma } from "@coinbase-trading-bot/shared/server";
import { runBacktest } from "../src/services/backtestRunner";
import { createSession } from "../src/services/sessionFactory";

const PRODUCT_ID = "SOL-USDC";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

async function runDcaScenario() {
  const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "dca" } });

  const strategyConfig = await prisma.strategyConfig.create({
    data: {
      strategyId: strategy.id,
      name: "smoke-test-backtest (ephemeral)",
      params: {
        productId: PRODUCT_ID,
        amountPerBuy: 10,
        interval: "daily",
        durationDays: 3,
      },
    },
  });

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - THREE_DAYS_MS);

  const session = await createSession({
    mode: "BACKTEST",
    strategyConfigId: strategyConfig.id,
    productId: PRODUCT_ID,
    initialQuoteBalance: 1000,
    initialBaseBalance: 0,
    startDate,
    endDate,
  });

  console.log(`[dca] Created backtest session ${session.id} over ${startDate.toISOString()} .. ${endDate.toISOString()}. Running...`);

  try {
    await runBacktest(session.id);

    const [orders, fills, dbSession] = await Promise.all([
      prisma.order.findMany({ where: { sessionId: session.id } }),
      prisma.fill.findMany({ where: { order: { sessionId: session.id } } }),
      prisma.session.findUniqueOrThrow({ where: { id: session.id } }),
    ]);

    console.log(`[dca] Orders: ${orders.length}, Fills: ${fills.length}, status: ${dbSession.status}, resultsSummary: ${JSON.stringify(dbSession.resultsSummary)}`);

    if (dbSession.status !== "COMPLETED") throw new Error(`Expected status COMPLETED, got ${dbSession.status}`);
    if (orders.length === 0) throw new Error("Expected at least one Order (a scheduled DCA buy) — got zero");
    if (fills.length !== orders.length) throw new Error(`Expected one Fill per Order, got ${orders.length} orders / ${fills.length} fills`);
    if (!dbSession.resultsSummary) throw new Error("Expected resultsSummary to be populated");

    console.log("[dca] PASSED");
  } finally {
    await prisma.trade.deleteMany({ where: { sessionId: session.id } });
    await prisma.fill.deleteMany({ where: { order: { sessionId: session.id } } });
    await prisma.missedFill.deleteMany({ where: { sessionId: session.id } });
    await prisma.balance.deleteMany({ where: { sessionId: session.id } });
    await prisma.order.deleteMany({ where: { sessionId: session.id } });
    await prisma.session.delete({ where: { id: session.id } });
    await prisma.strategyConfig.delete({ where: { id: strategyConfig.id } });
  }
}

async function runGridRoundTripScenario() {
  const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "grid" } });

  const strategyConfig = await prisma.strategyConfig.create({
    data: {
      strategyId: strategy.id,
      name: "smoke-test-backtest grid round-trip (ephemeral)",
      params: {
        productId: PRODUCT_ID,
        levels: [
          { price: 74, side: "BUY" },
          { price: 80, side: "SELL" },
          { price: 84, side: "BUY" },
          { price: 92, side: "SELL" },
          { price: 96, side: "BUY" },
          { price: 104, side: "SELL" },
        ],
        amountPerLevel: 200,
        stopLimitBufferPct: 0.5,
        marketFallback: { enabled: false, timeoutSeconds: 300 },
      },
    },
  });

  const startDate = new Date("2026-08-03T00:00:00.000Z");
  const endDate = new Date("2026-09-02T00:00:00.000Z");

  const session = await createSession({
    mode: "BACKTEST",
    strategyConfigId: strategyConfig.id,
    productId: PRODUCT_ID,
    initialQuoteBalance: 5000,
    initialBaseBalance: 0,
    startDate,
    endDate,
  });

  console.log(`[grid round-trip] Created backtest session ${session.id} over the fixed ${startDate.toISOString()} .. ${endDate.toISOString()} window. Running...`);

  try {
    await runBacktest(session.id);

    const dbSession = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    if (dbSession.status !== "COMPLETED") throw new Error(`Expected status COMPLETED, got ${dbSession.status}`);

    const report = dbSession.resultsSummary as {
      performance: { roundTripCount: number; winRatePct: number | null; missedFillCount: number };
      trades: Array<{ costBasis: number; pnl: number }>;
      missedFills: unknown[];
    } | null;
    if (!report) throw new Error("Expected resultsSummary to be populated");

    console.log(
      `[grid round-trip] roundTripCount=${report.performance.roundTripCount} winRatePct=${report.performance.winRatePct} missedFillCount=${report.performance.missedFillCount}`,
    );

    // The actual regression check: this exact window/level combination is known (empirically
    // confirmed while writing this test) to produce a completed BUY@96 -> SELL@104 round trip. If
    // sessionManager.ts's BUY-order lookup for a grid SELL ever regresses back to matching on
    // `levelPrice` instead of `closingLevelPrice`, this assertion fails loudly instead of the round
    // trip silently vanishing into a console.warn no one is watching.
    if (report.trades.length === 0) throw new Error("Expected at least one completed Trade round trip — got zero (the exact regression this test guards)");
    if (report.performance.winRatePct === null) throw new Error("Expected a non-null winRatePct once a round trip completed");
    if (!report.trades.some((t) => t.costBasis === 200)) throw new Error(`Expected a Trade with costBasis 200 (one amountPerLevel), got ${JSON.stringify(report.trades)}`);
    if (report.missedFills.length === 0) throw new Error("Expected at least one MissedFill over this window — got zero");

    console.log("[grid round-trip] PASSED");
  } finally {
    await prisma.trade.deleteMany({ where: { sessionId: session.id } });
    await prisma.fill.deleteMany({ where: { order: { sessionId: session.id } } });
    await prisma.missedFill.deleteMany({ where: { sessionId: session.id } });
    await prisma.balance.deleteMany({ where: { sessionId: session.id } });
    await prisma.order.deleteMany({ where: { sessionId: session.id } });
    await prisma.session.delete({ where: { id: session.id } });
    await prisma.strategyConfig.delete({ where: { id: strategyConfig.id } });
  }
}

async function main() {
  await runDcaScenario();
  await runGridRoundTripScenario();
  console.log("SMOKE TEST (backtestRunner.ts): PASSED");
}

main()
  .catch((error) => {
    console.error("SMOKE TEST (backtestRunner.ts): FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
