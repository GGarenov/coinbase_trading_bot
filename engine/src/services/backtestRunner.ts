import type { FeeSchedule, PortfolioState, PricePoint } from "@coinbase-trading-bot/shared";
import { getStrategyDefinition, prisma } from "@coinbase-trading-bot/shared";
import { fetchCandles } from "../exchange/coinbase/rest";
import type { DecisionProcessingContext } from "./sessionManager";
import { processDecisions } from "./sessionManager";

/**
 * Drives the exact same fill-booking path paper trading uses
 * (`sessionManager.ts`'s `processDecisions`, backed by `simulation.ts`),
 * but iterates historical candles instead of the live `priceStream` — so a
 * backtest and a paper session can never silently drift apart in how a
 * fill is decided or recorded.
 *
 * Scope note: this is Session Manager's own task-list item ("drives
 * simulation.ts from a historical candle iterator instead of the live
 * PriceStream"), not the full Backtesting section. `PriceCandleCache`
 * read/write caching and the analytics report (Sharpe/Sortino/drawdown/
 * etc.) are separate, not-yet-built `docs/tasks-backend.md` "Backtesting"
 * tasks — candles are fetched fresh from Coinbase on every run for now,
 * and `resultsSummary` is a minimal placeholder (final equity + trade
 * count), not the full report.
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
  // simplification acceptable for this pass; a precise per-granularity version belongs to the
  // full Backtesting-section work, which also owns PriceCandleCache.
  const warmupCandleCount = typeof definition.warmupCandles === "function" ? definition.warmupCandles(params) : (definition.warmupCandles ?? 0);
  const warmupMs = warmupCandleCount * 60 * 60 * 1000;

  const candles = await fetchCandles(session.productId, "ONE_HOUR", startMs - warmupMs, endMs);

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
      await processDecisions(ctx, decisions, point);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- strategyState is an opaque Json snapshot
      await prisma.session.update({ where: { id: sessionId }, data: { strategyState: strategy.getState() as any } });
    }
  }

  const finalPrice = candles.length > 0 ? candles[candles.length - 1].close : 0;
  const finalEquity = ctx.portfolio.quoteBalance + ctx.portfolio.baseBalance * finalPrice;
  const tradeCount = await prisma.trade.count({ where: { sessionId } });

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      status: "COMPLETED",
      stoppedAt: new Date(),
      // Minimal placeholder — the full metrics report is the Backtesting section's job, not this one's.
      resultsSummary: { finalEquity, tradeCount, candleCount: candles.length },
    },
  });
}
