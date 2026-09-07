import type { FeeSchedule, Granularity } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";
import { runBacktest } from "../services/backtestRunner";
import { getCachedCandles } from "../services/priceCandleCache";
import { computePriceSummary } from "../services/priceSummary";
import { createSession } from "../services/sessionFactory";

export const backtestsRouter: ExpressRouter = Router();

/** Matches `BACKTEST_GRANULARITY` in `backtestRunner.ts` — the candles a backtest was actually run on. */
const CANDLE_GRANULARITY: Granularity = "ONE_HOUR";

const feeScheduleSchema = z.object({ makerRate: z.number().positive(), takerRate: z.number().positive() }) satisfies z.ZodType<FeeSchedule>;

const createBacktestSchema = z.object({
  strategyConfigId: z.number().int().positive(),
  productId: z.string().min(1),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  initialQuoteBalance: z.number().positive(),
  initialBaseBalance: z.number().nonnegative().default(0),
  feeScheduleOverride: feeScheduleSchema.optional(),
});

/**
 * POST /backtests — accepts a strategy config + date range + productId,
 * runs `backtestRunner.ts`, and persists a completed `Session` with the
 * full report in `resultsSummary`.
 *
 * Scope note: runs the backtest SYNCHRONOUSLY within this request — fine
 * for the day-to-few-months hourly-candle windows this project targets,
 * but a genuinely long-running backtest would need to become an async job
 * with polling instead. Not built here — a known limit of this first cut.
 */
backtestsRouter.post("/", async (req, res) => {
  const parsed = createBacktestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  try {
    const session = await createSession({
      mode: "BACKTEST",
      strategyConfigId: body.strategyConfigId,
      productId: body.productId,
      initialQuoteBalance: body.initialQuoteBalance,
      initialBaseBalance: body.initialBaseBalance,
      startDate: new Date(body.startDate),
      endDate: new Date(body.endDate),
      feeScheduleOverride: body.feeScheduleOverride,
    });

    await runBacktest(session.id);

    const completed = await prisma.session.findUniqueOrThrow({
      where: { id: session.id },
      include: { strategyConfig: { include: { strategy: true } } },
    });
    res.status(201).json({
      sessionId: completed.id,
      status: completed.status,
      strategy: { slug: completed.strategyConfig.strategy.slug, name: completed.strategyConfig.strategy.name },
      productId: completed.productId,
      report: completed.resultsSummary,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** GET /backtests/:id — returns the full report (metrics + trade log + equity curve). */
backtestsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id must be an integer" });
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id },
    include: { strategyConfig: { include: { strategy: true } } },
  });
  if (!session || session.mode !== "BACKTEST") {
    res.status(404).json({ error: `No backtest session with id ${id}` });
    return;
  }

  res.json({
    sessionId: session.id,
    status: session.status,
    strategy: { slug: session.strategyConfig.strategy.slug, name: session.strategyConfig.strategy.name },
    // The exact params the run used. Exposed so the dashboard can overlay configured price
    // levels on the price chart (`GET /:id/candles`) without a second round trip to /configs.
    strategyConfig: { id: session.strategyConfig.id, name: session.strategyConfig.name, params: session.strategyConfig.params },
    productId: session.productId,
    startDate: session.startDate,
    endDate: session.endDate,
    error: session.error,
    // The full BacktestReport shape (performance/equityCurve/trades/missedFills/curveFittingWarning)
    // once status is COMPLETED; null/absent while still RUNNING or if it FAILED.
    report: session.resultsSummary,
  });
});

/**
 * GET /backtests/:id/candles — the price context behind a completed
 * backtest: the exact OHLC candles the run was fed, plus a min/max/avg
 * summary of them.
 *
 * Reads through `getCachedCandles`, which the run itself already populated
 * for this product/window, so this is normally a pure cache read and never
 * a fresh Coinbase call. Note it requests the SESSION's window only — the
 * runner additionally pre-fetches indicator warm-up candles before
 * `startDate`, and those are deliberately excluded here: they're strategy
 * plumbing, not part of the period being reported on.
 */
backtestsRouter.get("/:id/candles", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id must be an integer" });
    return;
  }

  const session = await prisma.session.findUnique({ where: { id } });
  if (!session || session.mode !== "BACKTEST") {
    res.status(404).json({ error: `No backtest session with id ${id}` });
    return;
  }
  if (session.status !== "COMPLETED") {
    res.status(409).json({ error: `Backtest ${id} is not completed (status: ${session.status})` });
    return;
  }
  if (!session.startDate || !session.endDate) {
    res.status(409).json({ error: `Backtest ${id} is missing startDate/endDate` });
    return;
  }

  try {
    const candles = await getCachedCandles(session.productId, CANDLE_GRANULARITY, session.startDate.getTime(), session.endDate.getTime());
    res.json({ granularity: CANDLE_GRANULARITY, candles, priceSummary: computePriceSummary(candles) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
