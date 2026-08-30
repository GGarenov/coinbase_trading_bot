import type { FeeSchedule, Granularity, PortfolioState, PricePoint } from "@coinbase-trading-bot/shared";
import { getStrategyDefinition, prisma } from "@coinbase-trading-bot/shared";
import type { BacktestReport } from "./backtestAnalytics";
import { computePerformanceMetrics } from "./backtestAnalytics";
import { checkCurveFittingRisk } from "./curveFittingCheck";
import { getCachedCandles } from "./priceCandleCache";
import type { DecisionProcessingContext } from "./sessionManager";
import { processDecisions } from "./sessionManager";

const BACKTEST_GRANULARITY: Granularity = "ONE_HOUR";

/**
 * Drives the exact same fill-booking path paper trading uses
 * (`sessionManager.ts`'s `processDecisions`, backed by `simulation.ts`),
 * but iterates historical candles (via `priceCandleCache.ts`, cached
 * against re-fetching Coinbase on every re-run) instead of the live
 * `priceStream` — so a backtest and a paper session can never silently
 * drift apart in how a fill is decided or recorded.
 */
export async function runBacktest(sessionId: number): Promise<void> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { strategyConfig: { include: { strategy: true } } },
  });
  if (session.mode !== "BACKTEST") throw new Error(`Session ${sessionId} is not a BACKTEST session (mode: ${session.mode})`);
  if (!session.startDate || !session.endDate) throw new Error(`Session ${sessionId} is missing startDate/endDate`);

  const definition = getStrategyDefinition(session.strategyConfig.strategy.slug);
  if (!definition) throw new Error(`Unknown strategy slug: ${session.strategyConfig.strategy.slug}`);
  const params = definition.paramsSchema.parse(session.strategyConfig.params);

  const startMs = session.startDate.getTime();
  const endMs = session.endDate.getTime();
  const strategy = definition.create(params, startMs);

  // Indicator strategies (MA crossover, RSI) need warm-up history before the real window starts.
  // Measured in hourly candles regardless of the strategy's own configured granularity — a
  // simplification acceptable for this pass.
  const warmupCandleCount = typeof definition.warmupCandles === "function" ? definition.warmupCandles(params) : (definition.warmupCandles ?? 0);
  const warmupMs = warmupCandleCount * 60 * 60 * 1000;

  const candles = await getCachedCandles(session.productId, BACKTEST_GRANULARITY, startMs - warmupMs, endMs);

  await prisma.session.update({ where: { id: sessionId }, data: { status: "RUNNING", startedAt: new Date() } });

  const feeSchedule = session.feeSchedule as unknown as FeeSchedule;
  const portfolio: PortfolioState = {
    quoteBalance: Number(session.initialQuoteBalance),
    baseBalance: Number(session.initialBaseBalance),
  };

  const ctx: DecisionProcessingContext = {
    sessionId,
    mode: "BACKTEST",
    strategy,
    feeSchedule,
    productInfo: null,
    portfolio,
  };

  for (const candle of candles) {
    const point: PricePoint = { price: candle.close, timestamp: candle.openTime };
    if (candle.openTime < startMs) {
      // Warm-up candle: feed it so indicators prime correctly, but discard any decisions it produces.
      strategy.onPrice(point, ctx.portfolio);
      continue;
    }

    const decisions = strategy.onPrice(point, ctx.portfolio);
    if (decisions.length > 0) {
      await processDecisions(ctx, decisions, point); // writes its own Balance row already
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- strategyState is an opaque Json snapshot
      await prisma.session.update({ where: { id: sessionId }, data: { strategyState: strategy.getState() as any } });
      // No decision this candle, but the equity curve still needs a mark-to-market point here —
      // otherwise Sharpe/Sortino/drawdown would only sample the (irregularly-spaced) ticks that
      // happened to trade, rather than a proper per-candle curve. Cheap for a backtest: a finite,
      // bounded run (unlike a month-long paper session, where writing a Balance row every tick
      // would be wasteful — see sessionManager.ts's handleTick for that tradeoff).
      await prisma.balance.create({
        data: {
          sessionId,
          timestamp: new Date(point.timestamp),
          quoteBalance: ctx.portfolio.quoteBalance,
          baseBalance: ctx.portfolio.baseBalance,
          equity: ctx.portfolio.quoteBalance + ctx.portfolio.baseBalance * point.price,
        },
      });
    }
  }

  const [balances, trades, missedFills] = await Promise.all([
    prisma.balance.findMany({ where: { sessionId }, orderBy: { timestamp: "asc" } }),
    prisma.trade.findMany({ where: { sessionId }, orderBy: { closedAt: "asc" } }),
    prisma.missedFill.findMany({ where: { sessionId }, orderBy: { occurredAt: "asc" } }),
  ]);

  const finalPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const finalEquity = ctx.portfolio.quoteBalance + ctx.portfolio.baseBalance * finalPrice;

  const equityCurve = balances.map((b) => ({ timestamp: b.timestamp.getTime(), equity: Number(b.equity) }));
  const tradeRecords = trades.map((t) => ({
    costBasis: Number(t.costBasis),
    proceeds: Number(t.proceeds),
    feesTotal: Number(t.feesTotal),
    pnl: Number(t.pnl),
    openedAt: t.openedAt.getTime(),
    closedAt: t.closedAt.getTime(),
  }));

  const performance = computePerformanceMetrics({
    initialQuoteBalance: Number(session.initialQuoteBalance),
    finalEquity,
    equityCurve,
    trades: tradeRecords,
    missedFillCount: missedFills.length,
    granularity: BACKTEST_GRANULARITY,
    periodStartMs: startMs,
    periodEndMs: endMs,
  });

  const curveFittingWarning = await checkCurveFittingRisk({
    strategyId: session.strategyConfig.strategyId,
    productId: session.productId,
    startDate: session.startDate,
    endDate: session.endDate,
    excludeSessionId: sessionId,
    excludeStrategyConfigId: session.strategyConfigId,
  });

  const report: BacktestReport = {
    performance,
    equityCurve,
    trades: tradeRecords,
    missedFills: missedFills.map((m) => ({
      levelPrice: Number(m.levelPrice),
      side: m.side,
      reason: m.reason,
      occurredAt: m.occurredAt.getTime(),
    })),
    curveFittingWarning,
  };

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      stoppedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- resultsSummary is an opaque Json report payload
      resultsSummary: report as any,
    },
  });
}
