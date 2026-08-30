import { Prisma } from "@prisma/client";
import { prisma } from "../src/prisma";

// Manual check for the "Decimal fields on SQLite" task in
// docs/tasks-database.md: insert a value with 8 decimal places (matching
// the precision crypto amounts need) through the full Strategy ->
// StrategyConfig -> Session -> Balance chain, read it back, and confirm
// there's no float drift. Cleans up its own test rows afterward.

const TEST_VALUE = "123.12345678";
const TEST_SLUG = "__decimal-precision-test-strategy__";

async function main() {
  const strategy = await prisma.strategy.create({
    data: {
      slug: TEST_SLUG,
      name: "Decimal Precision Test",
      description: "Throwaway row created by verify-decimal-precision.ts",
      riskLevel: "n/a",
      defaultParams: {},
    },
  });

  const strategyConfig = await prisma.strategyConfig.create({
    data: {
      strategyId: strategy.id,
      name: "test-config",
      params: {},
    },
  });

  const session = await prisma.session.create({
    data: {
      mode: "BACKTEST",
      strategyConfigId: strategyConfig.id,
      productId: "SOL-USDC",
      initialQuoteBalance: new Prisma.Decimal(TEST_VALUE),
      initialBaseBalance: new Prisma.Decimal(0),
      feeSchedule: { makerRate: 0.006, takerRate: 0.012 },
    },
  });

  const balance = await prisma.balance.create({
    data: {
      sessionId: session.id,
      timestamp: new Date(),
      quoteBalance: new Prisma.Decimal(TEST_VALUE),
      baseBalance: new Prisma.Decimal(0),
      equity: new Prisma.Decimal(TEST_VALUE),
    },
  });

  const readBack = balance.quoteBalance.toString();
  const passed = readBack === TEST_VALUE;

  console.log(`Wrote:  ${TEST_VALUE}`);
  console.log(`Read:   ${readBack}`);
  console.log(passed ? "PASS: no float drift" : "FAIL: value changed on round-trip");

  // Cleanup, reverse FK order.
  await prisma.balance.delete({ where: { id: balance.id } });
  await prisma.session.delete({ where: { id: session.id } });
  await prisma.strategyConfig.delete({ where: { id: strategyConfig.id } });
  await prisma.strategy.delete({ where: { id: strategy.id } });

  if (!passed) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
