/**
 * Manual smoke test for services/backtestRunner.ts — runs a real BACKTEST
 * session over the last 3 days of live SOL-USDC hourly candles (fetched
 * fresh from Coinbase, no caching yet — see backtestRunner.ts's scope
 * note), verifies the DB rows it should have produced, and cleans up
 * after itself.
 *
 * Uses "dca" (daily, 3-day duration) for the same reason the session-
 * manager smoke test does: it's the one strategy guaranteed to trade
 * (multiple times, over a 3-day window) regardless of what the actual
 * price did.
 */
import { DEFAULT_FEE_SCHEDULE, prisma } from "@coinbase-trading-bot/shared";
import { runBacktest } from "../src/services/backtestRunner";

const PRODUCT_ID = "SOL-USDC";
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

async function main() {
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

  const session = await prisma.session.create({
    data: {
      mode: "BACKTEST",
      strategyConfigId: strategyConfig.id,
      productId: PRODUCT_ID,
      initialQuoteBalance: 1000,
      initialBaseBalance: 0,
      feeSchedule: DEFAULT_FEE_SCHEDULE,
      startDate,
      endDate,
    },
  });

  console.log(`Created backtest session ${session.id} over ${startDate.toISOString()} .. ${endDate.toISOString()}. Running...`);

  try {
    await runBacktest(session.id);

    const [orders, fills, dbSession] = await Promise.all([
      prisma.order.findMany({ where: { sessionId: session.id } }),
      prisma.fill.findMany({ where: { order: { sessionId: session.id } } }),
      prisma.session.findUniqueOrThrow({ where: { id: session.id } }),
    ]);

    console.log(`Orders: ${orders.length}, Fills: ${fills.length}, status: ${dbSession.status}, resultsSummary: ${JSON.stringify(dbSession.resultsSummary)}`);

    if (dbSession.status !== "COMPLETED") throw new Error(`Expected status COMPLETED, got ${dbSession.status}`);
    if (orders.length === 0) throw new Error("Expected at least one Order (a scheduled DCA buy) — got zero");
    if (fills.length !== orders.length) throw new Error(`Expected one Fill per Order, got ${orders.length} orders / ${fills.length} fills`);
    if (!dbSession.resultsSummary) throw new Error("Expected resultsSummary to be populated");

    console.log("SMOKE TEST (backtestRunner.ts): PASSED");
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

main()
  .catch((error) => {
    console.error("SMOKE TEST (backtestRunner.ts): FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
