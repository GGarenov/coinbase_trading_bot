import { DEFAULT_FEE_SCHEDULE } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { afterAll, describe, expect, it } from "vitest";
import { checkCurveFittingRisk, OUT_OF_SAMPLE_RECOMMENDATION } from "./curveFittingCheck";

// (Proposed, tasks-qa.md Phase 7.1) — `checkCurveFittingRisk()` only ever
// runs a Prisma query, so this asserts it directly against real fixture
// `Session` rows (no actual backtest run needed — `runBacktest()` calls
// this function AFTER the run completes, but the check itself only cares
// about prior Session rows' mode/productId/dates/strategyConfigId, so
// fixture rows created directly are enough and much faster than running 3
// real backtests). Same real-DB convention as Phase 6's tests.

const PRODUCT_ID = "SOL-USDC";
const START = new Date("2026-08-03T00:00:00.000Z");
const END = new Date("2026-09-02T00:00:00.000Z");
const OTHER_WINDOW_START = new Date("2026-07-01T00:00:00.000Z");
const OTHER_WINDOW_END = new Date("2026-07-15T00:00:00.000Z");

afterAll(async () => {
  await prisma.$disconnect();
});

describe("checkCurveFittingRisk() — overfitting-warning test (Phase 7.1)", () => {
  it("warns when another backtest already ran the same strategy over the exact same window with different parameters", async () => {
    const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "grid" } });
    const configA = await prisma.strategyConfig.create({
      data: { strategyId: strategy.id, name: "phase7.1-curve-fit A (ephemeral)", params: { productId: PRODUCT_ID, levels: [], amountPerLevel: 100 } },
    });
    const configB = await prisma.strategyConfig.create({
      data: { strategyId: strategy.id, name: "phase7.1-curve-fit B, different params (ephemeral)", params: { productId: PRODUCT_ID, levels: [], amountPerLevel: 200 } },
    });

    const sessionIds: number[] = [];
    try {
      const sessionA = await prisma.session.create({
        data: {
          mode: "BACKTEST",
          status: "COMPLETED",
          strategyConfigId: configA.id,
          productId: PRODUCT_ID,
          initialQuoteBalance: 1000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same Json cast sessionFactory.ts uses
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startDate: START,
          endDate: END,
        },
      });
      sessionIds.push(sessionA.id);

      // First run over this window: nothing else has run it yet — no warning expected, matching
      // smoke-test-backtest-api.ts's already-established real-run behavior.
      const firstRunWarning = await checkCurveFittingRisk({
        strategyId: strategy.id,
        productId: PRODUCT_ID,
        startDate: START,
        endDate: END,
        excludeSessionId: sessionA.id,
        excludeStrategyConfigId: configA.id,
      });
      expect(firstRunWarning).toBeNull();

      const sessionB = await prisma.session.create({
        data: {
          mode: "BACKTEST",
          status: "COMPLETED",
          strategyConfigId: configB.id,
          productId: PRODUCT_ID,
          initialQuoteBalance: 1000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startDate: START,
          endDate: END,
        },
      });
      sessionIds.push(sessionB.id);

      // Second run, same strategy/product/window, DIFFERENT params (configB) — this is the actual
      // regression case: the warning must fire and name the out-of-sample recommendation.
      const secondRunWarning = await checkCurveFittingRisk({
        strategyId: strategy.id,
        productId: PRODUCT_ID,
        startDate: START,
        endDate: END,
        excludeSessionId: sessionB.id,
        excludeStrategyConfigId: configB.id,
      });
      expect(secondRunWarning).not.toBeNull();
      expect(secondRunWarning).toContain("1 other backtest(s)");
      expect(secondRunWarning).toContain(OUT_OF_SAMPLE_RECOMMENDATION);
    } finally {
      for (const id of sessionIds) await prisma.session.delete({ where: { id } }).catch(() => {});
      await prisma.strategyConfig.deleteMany({ where: { id: { in: [configA.id, configB.id] } } });
    }
  });

  it("does NOT warn for a different product or a different window — the check is scoped, not a blanket 'anything else ran before' flag", async () => {
    const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "grid" } });
    const configA = await prisma.strategyConfig.create({
      data: { strategyId: strategy.id, name: "phase7.1-scope A (ephemeral)", params: { productId: PRODUCT_ID, levels: [], amountPerLevel: 100 } },
    });
    const configB = await prisma.strategyConfig.create({
      data: { strategyId: strategy.id, name: "phase7.1-scope B, different params (ephemeral)", params: { productId: PRODUCT_ID, levels: [], amountPerLevel: 200 } },
    });

    const sessionIds: number[] = [];
    try {
      // A prior run exists, but on a DIFFERENT product.
      const differentProduct = await prisma.session.create({
        data: {
          mode: "BACKTEST",
          status: "COMPLETED",
          strategyConfigId: configA.id,
          productId: "BTC-USDC",
          initialQuoteBalance: 1000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startDate: START,
          endDate: END,
        },
      });
      sessionIds.push(differentProduct.id);

      // A prior run exists, same product, but a DIFFERENT window.
      const differentWindow = await prisma.session.create({
        data: {
          mode: "BACKTEST",
          status: "COMPLETED",
          strategyConfigId: configA.id,
          productId: PRODUCT_ID,
          initialQuoteBalance: 1000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startDate: OTHER_WINDOW_START,
          endDate: OTHER_WINDOW_END,
        },
      });
      sessionIds.push(differentWindow.id);

      const currentSession = await prisma.session.create({
        data: {
          mode: "BACKTEST",
          status: "COMPLETED",
          strategyConfigId: configB.id,
          productId: PRODUCT_ID,
          initialQuoteBalance: 1000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startDate: START,
          endDate: END,
        },
      });
      sessionIds.push(currentSession.id);

      const warning = await checkCurveFittingRisk({
        strategyId: strategy.id,
        productId: PRODUCT_ID,
        startDate: START,
        endDate: END,
        excludeSessionId: currentSession.id,
        excludeStrategyConfigId: configB.id,
      });
      expect(warning).toBeNull();
    } finally {
      for (const id of sessionIds) await prisma.session.delete({ where: { id } }).catch(() => {});
      await prisma.strategyConfig.deleteMany({ where: { id: { in: [configA.id, configB.id] } } });
    }
  });

  it("does NOT warn when the exact same config is simply re-run over the same window — that's a repeat, not parameter tweaking", async () => {
    const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "grid" } });
    const config = await prisma.strategyConfig.create({
      data: { strategyId: strategy.id, name: "phase7.1-rerun (ephemeral)", params: { productId: PRODUCT_ID, levels: [], amountPerLevel: 100 } },
    });

    const sessionIds: number[] = [];
    try {
      const firstRun = await prisma.session.create({
        data: {
          mode: "BACKTEST",
          status: "COMPLETED",
          strategyConfigId: config.id,
          productId: PRODUCT_ID,
          initialQuoteBalance: 1000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startDate: START,
          endDate: END,
        },
      });
      sessionIds.push(firstRun.id);

      const rerun = await prisma.session.create({
        data: {
          mode: "BACKTEST",
          status: "COMPLETED",
          strategyConfigId: config.id, // SAME config as firstRun
          productId: PRODUCT_ID,
          initialQuoteBalance: 1000,
          initialBaseBalance: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          feeSchedule: DEFAULT_FEE_SCHEDULE as any,
          startDate: START,
          endDate: END,
        },
      });
      sessionIds.push(rerun.id);

      const warning = await checkCurveFittingRisk({
        strategyId: strategy.id,
        productId: PRODUCT_ID,
        startDate: START,
        endDate: END,
        excludeSessionId: rerun.id,
        excludeStrategyConfigId: config.id,
      });
      expect(warning).toBeNull();
    } finally {
      for (const id of sessionIds) await prisma.session.delete({ where: { id } }).catch(() => {});
      await prisma.strategyConfig.delete({ where: { id: config.id } });
    }
  });
});
