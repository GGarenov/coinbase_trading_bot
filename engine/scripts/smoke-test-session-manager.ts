/**
 * Manual smoke test for services/sessionManager.ts — starts a real PAPER
 * session against Coinbase's live SOL-USDC ticker feed, lets it run long
 * enough to actually trade, then verifies the DB rows it should have
 * produced, and cleans up after itself.
 *
 * Uses the "dca" strategy configured to buy immediately (DCA's first buy
 * happens at the strategy's start, regardless of price) — this is the one
 * strategy guaranteed to produce a decision on the very first tick, rather
 * than depending on the live price actually crossing a grid level or an
 * indicator condition within the test's short run time.
 */
import { DEFAULT_FEE_SCHEDULE, prisma } from "@coinbase-trading-bot/shared";
import { getRunningSessionIds, priceStream, startSession, stopSession } from "../src/services/sessionManager";

const RUN_MS = 10_000;
const PRODUCT_ID = "SOL-USDC";

async function main() {
  const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "dca" } });

  const strategyConfig = await prisma.strategyConfig.create({
    data: {
      strategyId: strategy.id,
      name: "smoke-test-session-manager (ephemeral)",
      params: {
        productId: PRODUCT_ID,
        amountPerBuy: 10,
        interval: "daily",
        durationDays: 1,
      },
    },
  });

  const session = await prisma.session.create({
    data: {
      mode: "PAPER",
      strategyConfigId: strategyConfig.id,
      productId: PRODUCT_ID,
      initialQuoteBalance: 1000,
      initialBaseBalance: 0,
      feeSchedule: DEFAULT_FEE_SCHEDULE,
    },
  });

  console.log(`Created session ${session.id} (PAPER, dca, ${PRODUCT_ID}). Starting...`);

  try {
    await startSession(session.id);
    if (!getRunningSessionIds().includes(session.id)) {
      throw new Error("startSession() returned but the session isn't tracked as running");
    }
    console.log(`Session running. Shared priceStream now has ${priceStream.subscribedProductCount} product(s) subscribed. Waiting ${RUN_MS / 1000}s for real ticks...`);
    await new Promise((resolve) => setTimeout(resolve, RUN_MS));

    await stopSession(session.id);
    console.log("Session stopped.");

    const [orders, fills, balances, dbSession] = await Promise.all([
      prisma.order.findMany({ where: { sessionId: session.id } }),
      prisma.fill.findMany({ where: { order: { sessionId: session.id } } }),
      prisma.balance.findMany({ where: { sessionId: session.id } }),
      prisma.session.findUniqueOrThrow({ where: { id: session.id } }),
    ]);

    console.log(`Orders: ${orders.length}, Fills: ${fills.length}, Balances: ${balances.length}, status: ${dbSession.status}`);

    if (orders.length === 0) throw new Error("Expected at least one Order (the immediate DCA buy) — got zero");
    if (orders[0].side !== "BUY" || orders[0].status !== "FILLED") throw new Error(`Expected a FILLED BUY order, got ${orders[0].side}/${orders[0].status}`);
    if (fills.length === 0) throw new Error("Expected at least one Fill — got zero");
    if (balances.length === 0) throw new Error("Expected at least one Balance snapshot — got zero");
    if (dbSession.status !== "STOPPED") throw new Error(`Expected session status STOPPED, got ${dbSession.status}`);
    const finalBalance = balances[balances.length - 1];
    if (Number(finalBalance.quoteBalance) >= 1000) throw new Error("Expected quoteBalance to have decreased after a BUY — it didn't");

    console.log(`quoteBalance after the buy: ${finalBalance.quoteBalance} (started at 1000)`);
    console.log("SMOKE TEST (sessionManager.ts): PASSED");
  } finally {
    // Cleanup, respecting FK order: Trade -> Fill -> MissedFill -> Balance -> Order -> Session -> StrategyConfig.
    // The seeded Strategy catalog row itself is left untouched.
    await prisma.trade.deleteMany({ where: { sessionId: session.id } });
    await prisma.fill.deleteMany({ where: { order: { sessionId: session.id } } });
    await prisma.missedFill.deleteMany({ where: { sessionId: session.id } });
    await prisma.balance.deleteMany({ where: { sessionId: session.id } });
    await prisma.order.deleteMany({ where: { sessionId: session.id } });
    await prisma.session.delete({ where: { id: session.id } });
    await prisma.strategyConfig.delete({ where: { id: strategyConfig.id } });
    priceStream.close();
  }
}

main()
  .catch((error) => {
    console.error("SMOKE TEST (sessionManager.ts): FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
