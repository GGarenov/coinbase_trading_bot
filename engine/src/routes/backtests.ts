import type { FeeSchedule } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";
import { runBacktest } from "../services/backtestRunner";
import { createSession } from "../services/sessionFactory";

export const backtestsRouter: ExpressRouter = Router();

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

    const completed = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    res.status(201).json({ sessionId: completed.id, status: completed.status, report: completed.resultsSummary });
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

  const session = await prisma.session.findUnique({ where: { id } });
  if (!session || session.mode !== "BACKTEST") {
    res.status(404).json({ error: `No backtest session with id ${id}` });
    return;
  }

  res.json({
    sessionId: session.id,
    status: session.status,
    productId: session.productId,
    startDate: session.startDate,
    endDate: session.endDate,
    error: session.error,
    // The full BacktestReport shape (performance/equityCurve/trades/missedFills/curveFittingWarning)
    // once status is COMPLETED; null/absent while still RUNNING or if it FAILED.
    report: session.resultsSummary,
  });
});
