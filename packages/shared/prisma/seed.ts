import { prisma } from "../src/prisma";

// Catalog rows for the four strategies from PLAN.md. `defaultParams` seeds
// a sensible starting configuration in the dashboard's config form; the
// grid example levels match the SOL-USDC example used throughout planning.
const strategies = [
  {
    slug: "grid",
    name: "Grid Trading",
    description:
      "Places limit buy/sell orders at manually configured, non-uniform price levels. Uses stop-limit-with-buffer trigger logic to reduce missed fills, with an optional (off by default) market-order fallback on timeout.",
    riskLevel: "medium",
    defaultParams: {
      productId: "SOL-USDC",
      levels: [
        { price: 95, side: "BUY" },
        { price: 90, side: "BUY" },
        { price: 105, side: "SELL" },
        { price: 110, side: "SELL" },
      ],
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    },
  },
  {
    slug: "ma-crossover",
    name: "Moving Average Crossover",
    description:
      "Buys on a golden cross (fast MA crosses above slow MA), sells on a death cross (fast MA crosses below slow MA).",
    riskLevel: "medium",
    defaultParams: {
      productId: "SOL-USDC",
      fastPeriod: 9,
      slowPeriod: 21,
      granularity: "ONE_HOUR",
    },
  },
  {
    slug: "dca",
    name: "Dollar-Cost Averaging",
    description:
      "Buys a fixed quote amount on a fixed schedule, regardless of price. Buy-only — never sells.",
    riskLevel: "low",
    defaultParams: {
      productId: "SOL-USDC",
      amountPerBuy: 25,
      intervalHours: 24,
    },
  },
  {
    slug: "rsi-mean-reversion",
    name: "RSI Mean Reversion",
    description:
      "Buys when RSI signals oversold conditions, sells when overbought. One position at a time.",
    riskLevel: "high",
    defaultParams: {
      productId: "SOL-USDC",
      rsiPeriod: 14,
      oversold: 30,
      overbought: 70,
      amountPerEntry: 25,
    },
  },
];

async function main() {
  for (const strategy of strategies) {
    const result = await prisma.strategy.upsert({
      where: { slug: strategy.slug },
      update: {
        name: strategy.name,
        description: strategy.description,
        riskLevel: strategy.riskLevel,
        defaultParams: strategy.defaultParams,
      },
      create: strategy,
    });
    console.log(`Seeded strategy: ${result.slug} (id=${result.id})`);
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
