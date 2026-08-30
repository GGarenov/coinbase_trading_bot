/**
 * Manual smoke test for the /backtests HTTP routes (routes/backtests.ts,
 * app.ts) plus PriceCandleCache caching (services/priceCandleCache.ts) —
 * makes real HTTP requests against a locally-started instance of the
 * actual engine app, over a real SOL-USDC historical window, and confirms
 * the second run over the same window is served from the cache instead of
 * hitting Coinbase again. Also exercises the curve-fitting warning by
 * running two different configs over the same window.
 */
import { prisma } from "@coinbase-trading-bot/shared";
import { createApp } from "../src/app";

const PRODUCT_ID = "SOL-USDC";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

async function main() {
  const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "dca" } });

  const configA = await prisma.strategyConfig.create({
    data: {
      strategyId: strategy.id,
      name: "smoke-test-backtest-api A (ephemeral)",
      params: { productId: PRODUCT_ID, amountPerBuy: 10, interval: "daily", durationDays: 3 },
    },
  });
  const configB = await prisma.strategyConfig.create({
    data: {
      strategyId: strategy.id,
      name: "smoke-test-backtest-api B (ephemeral, different params)",
      params: { productId: PRODUCT_ID, amountPerBuy: 20, interval: "daily", durationDays: 3 },
    },
  });

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - THREE_DAYS_MS);

  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const sessionIds: number[] = [];
  try {
    const candlesBeforeCount = await prisma.priceCandleCache.count({ where: { productId: PRODUCT_ID } });

    // First run: this window has never been backtested before -> expect a cache miss (candles get
    // fetched from Coinbase and stored) and no curve-fitting warning (nothing else ran this window yet).
    const resA = await fetch(`${baseUrl}/backtests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyConfigId: configA.id,
        productId: PRODUCT_ID,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        initialQuoteBalance: 1000,
        initialBaseBalance: 0,
      }),
    });
    if (resA.status !== 201) throw new Error(`Expected 201 from POST /backtests, got ${resA.status}: ${await resA.text()}`);
    const bodyA = (await resA.json()) as { sessionId: number; status: string; report: { performance: unknown; curveFittingWarning: string | null } };
    sessionIds.push(bodyA.sessionId);
    if (bodyA.status !== "COMPLETED") throw new Error(`Expected COMPLETED, got ${bodyA.status}`);
    if (!bodyA.report?.performance) throw new Error("Expected report.performance to be populated");
    if (bodyA.report.curveFittingWarning !== null) throw new Error("Expected no curve-fitting warning on the first run over a fresh window");
    console.log(`POST /backtests (run A): 201, session ${bodyA.sessionId}, no curve-fitting warning (correct, first run)`);

    // Not asserted strictly ">" here: other smoke tests (smoke-test-backtest.ts) run over a
    // similar "last 3 days" window and may have already warmed the cache for these hour buckets
    // in the same dev session — that's the cache working correctly, not a test failure. The real
    // guarantee (no re-fetch on a genuine repeat of the SAME window) is asserted below instead.
    const candlesAfterFirstRun = await prisma.priceCandleCache.count({ where: { productId: PRODUCT_ID } });
    console.log(`PriceCandleCache: ${candlesBeforeCount} -> ${candlesAfterFirstRun} rows after run A`);

    // GET the report back.
    const getRes = await fetch(`${baseUrl}/backtests/${bodyA.sessionId}`);
    if (!getRes.ok) throw new Error(`Expected 200 from GET /backtests/:id, got ${getRes.status}`);
    const getBody = (await getRes.json()) as { report: { performance: unknown } };
    if (!getBody.report?.performance) throw new Error("GET /backtests/:id did not return a populated report");
    console.log("GET /backtests/:id: 200, report present");

    // Second run: SAME window, DIFFERENT config -> expect a cache HIT (no new PriceCandleCache rows)
    // and a curve-fitting warning (run A already covered this exact window).
    const resB = await fetch(`${baseUrl}/backtests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyConfigId: configB.id,
        productId: PRODUCT_ID,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        initialQuoteBalance: 1000,
        initialBaseBalance: 0,
      }),
    });
    if (resB.status !== 201) throw new Error(`Expected 201 from POST /backtests (run B), got ${resB.status}: ${await resB.text()}`);
    const bodyB = (await resB.json()) as { sessionId: number; report: { curveFittingWarning: string | null } };
    sessionIds.push(bodyB.sessionId);
    if (!bodyB.report.curveFittingWarning) throw new Error("Expected a curve-fitting warning on the second run over the same window");
    console.log(`POST /backtests (run B): curve-fitting warning present, as expected: "${bodyB.report.curveFittingWarning.slice(0, 60)}..."`);

    const candlesAfterSecondRun = await prisma.priceCandleCache.count({ where: { productId: PRODUCT_ID } });
    if (candlesAfterSecondRun !== candlesAfterFirstRun) throw new Error(`Expected no new PriceCandleCache rows on the second run (cache hit), but count changed ${candlesAfterFirstRun} -> ${candlesAfterSecondRun}`);
    console.log(`PriceCandleCache stayed at ${candlesAfterSecondRun} rows (cache hit -> no re-fetch from Coinbase, as expected)`);

    console.log("SMOKE TEST (backtests HTTP routes + PriceCandleCache): PASSED");
  } finally {
    server.close();
    for (const sessionId of sessionIds) {
      await prisma.trade.deleteMany({ where: { sessionId } });
      await prisma.fill.deleteMany({ where: { order: { sessionId } } });
      await prisma.missedFill.deleteMany({ where: { sessionId } });
      await prisma.balance.deleteMany({ where: { sessionId } });
      await prisma.order.deleteMany({ where: { sessionId } });
      await prisma.session.delete({ where: { id: sessionId } });
    }
    await prisma.strategyConfig.deleteMany({ where: { id: { in: [configA.id, configB.id] } } });
    // PriceCandleCache rows are deliberately NOT cleaned up — they're legitimate cached historical
    // data (the whole point of this test), not test pollution, same as the seeded Strategy catalog.
  }
}

main()
  .catch((error) => {
    console.error("SMOKE TEST (backtests HTTP routes + PriceCandleCache): FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
