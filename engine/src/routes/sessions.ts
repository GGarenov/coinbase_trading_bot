import type { FeeSchedule } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import type { Prisma } from "@prisma/client";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";
import { computePerformanceMetrics } from "../services/backtestAnalytics";
import { createSession } from "../services/sessionFactory";
import { getSessionRuntimeSnapshot, pauseSession, startSession, stopSession } from "../services/sessionManager";

export const sessionsRouter: ExpressRouter = Router();

const feeScheduleSchema = z.object({ makerRate: z.number().positive(), takerRate: z.number().positive() }) satisfies z.ZodType<FeeSchedule>;

const createSessionSchema = z.object({
  strategyConfigId: z.number().int().positive(),
  productId: z.string().min(1),
  // Deliberately excludes BACKTEST — that mode already has its own creation path (`POST /backtests`),
  // which runs synchronously and returns a finished report rather than a long-running subscription.
  mode: z.enum(["PAPER", "LIVE"]),
  initialQuoteBalance: z.number().positive(),
  initialBaseBalance: z.number().nonnegative().default(0),
  feeScheduleOverride: feeScheduleSchema.optional(),
  // Live-Trading Safety Rails caps — see sessionFactory.ts/liveSafetyGuard.ts. Not required at the
  // schema level (a PAPER session has no use for them), but strongly recommended for any LIVE one;
  // the dashboard's "start live session" confirmation step (tasks-frontend.md Phase 4.6) is where
  // that should actually be enforced/nudged, not here.
  maxSpendPerOrder: z.number().positive().optional(),
  maxPositionSize: z.number().positive().optional(),
});

type OrderWithFills = Prisma.OrderGetPayload<{ include: { fills: true } }>;

/**
 * Prisma's `Decimal` fields serialize to JSON as STRINGS (via decimal.js's
 * own `toJSON()`), not numbers — confirmed empirically, not assumed. Every
 * other numeric field in this route's responses is explicitly converted
 * with `Number(...)` before `res.json()`; these three mapping functions do
 * the same for `Order`/`Fill`/`Trade`/`MissedFill` rows specifically, so
 * `GET /sessions/:id`'s wire contract is consistently all-numbers, not a
 * mix of numbers and numeric-looking strings depending on which field you
 * ask for.
 */
function toOrderDto(order: OrderWithFills) {
  return {
    id: order.id,
    side: order.side,
    type: order.type,
    price: order.price !== null ? Number(order.price) : null,
    stopPrice: order.stopPrice !== null ? Number(order.stopPrice) : null,
    size: order.size !== null ? Number(order.size) : null,
    status: order.status,
    exchangeOrderId: order.exchangeOrderId,
    levelPrice: order.levelPrice !== null ? Number(order.levelPrice) : null,
    rejectionReason: order.rejectionReason,
    createdAt: order.createdAt,
    filledAt: order.filledAt,
    fills: order.fills.map((f) => ({
      id: f.id,
      price: Number(f.price),
      size: Number(f.size),
      fee: Number(f.fee),
      feeRate: Number(f.feeRate),
      liquidity: f.liquidity,
      timestamp: f.timestamp,
    })),
  };
}

function toTradeDto(trade: Prisma.TradeGetPayload<object>) {
  return {
    id: trade.id,
    buyFillId: trade.buyFillId,
    sellFillId: trade.sellFillId,
    costBasis: Number(trade.costBasis),
    proceeds: Number(trade.proceeds),
    feesTotal: Number(trade.feesTotal),
    pnl: Number(trade.pnl),
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
  };
}

function toMissedFillDto(missedFill: Prisma.MissedFillGetPayload<object>) {
  return {
    id: missedFill.id,
    levelPrice: Number(missedFill.levelPrice),
    side: missedFill.side,
    reason: missedFill.reason,
    occurredAt: missedFill.occurredAt,
  };
}

function toSessionSummary(session: {
  id: number;
  mode: string;
  status: string;
  productId: string;
  startedAt: Date | null;
  stoppedAt: Date | null;
  createdAt: Date;
  error: string | null;
  strategyConfig: { id: number; name: string; strategy: { slug: string; name: string } };
}) {
  return {
    id: session.id,
    mode: session.mode,
    status: session.status,
    productId: session.productId,
    strategy: { slug: session.strategyConfig.strategy.slug, name: session.strategyConfig.strategy.name },
    strategyConfigId: session.strategyConfig.id,
    strategyConfigName: session.strategyConfig.name,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    createdAt: session.createdAt,
    error: session.error,
  };
}

/**
 * GET /sessions — a summary list of PAPER/LIVE sessions, for the session
 * list on `page.tsx` and as the base of the compare view. BACKTEST sessions
 * are deliberately excluded — those are listed/fetched via `/backtests`
 * instead, which returns the full report shape rather than a running
 * session's live summary. Pass `?mode=PAPER` or `?mode=LIVE` to narrow.
 */
sessionsRouter.get("/", async (req, res) => {
  const modeFilter = z.enum(["PAPER", "LIVE"]).optional().safeParse(req.query.mode).data;
  const sessions = await prisma.session.findMany({
    where: { mode: modeFilter ? modeFilter : { in: ["PAPER", "LIVE"] } },
    include: { strategyConfig: { include: { strategy: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(sessions.map(toSessionSummary));
});

/**
 * GET /sessions/compare — per-session metrics for `compare/page.tsx`'s
 * table + equity-curve overlay (P&L, win rate, fees, drawdown, completed
 * cycles), across every PAPER/LIVE session regardless of status, so
 * finished paper trials stay comparable, not just currently-running ones.
 *
 * MUST be registered before `GET /:id` below — otherwise Express would
 * match `/:id` first with `id="compare"`, which fails the integer check.
 *
 * Reuses `backtestAnalytics.ts`'s `computePerformanceMetrics()` against each
 * session's own `Trade`/`Balance` rows instead of a finished backtest's, per
 * the plan recorded in `tasks-backend.md`. One honest caveat, documented
 * rather than silently glossed over: unlike a backtest's evenly-spaced
 * per-candle equity curve, a paper/live session's `Balance` rows are only
 * written when a decision actually fires (see `sessionManager.ts`'s
 * `handleTick`), so they're irregularly spaced in real time. Sharpe/Sortino
 * annualization assumes a fixed period length, which doesn't hold here — so
 * this route deliberately does NOT expose `sharpeRatio`/`sortinoRatio` at
 * all (not part of the requested comparison columns anyway); everything it
 * does expose (total P&L, win rate, max drawdown, completed cycles) holds up
 * fine on an irregular curve.
 */
sessionsRouter.get("/compare", async (_req, res) => {
  const sessions = await prisma.session.findMany({
    where: { mode: { in: ["PAPER", "LIVE"] } },
    include: {
      strategyConfig: { include: { strategy: true } },
      trades: true,
      balances: { orderBy: { timestamp: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = await Promise.all(
    sessions.map(async (session) => {
      const [feesAgg, missedFillCount] = await Promise.all([
        prisma.fill.aggregate({ where: { order: { sessionId: session.id } }, _sum: { fee: true } }),
        prisma.missedFill.count({ where: { sessionId: session.id } }),
      ]);
      const feesPaid = Number(feesAgg._sum.fee ?? 0);

      const trades = session.trades.map((t) => ({
        costBasis: Number(t.costBasis),
        proceeds: Number(t.proceeds),
        feesTotal: Number(t.feesTotal),
        pnl: Number(t.pnl),
        openedAt: t.openedAt.getTime(),
        closedAt: t.closedAt.getTime(),
      }));
      const equityCurve = session.balances.map((b) => ({ timestamp: b.timestamp.getTime(), equity: Number(b.equity) }));

      // If this session is actively running in this process, append a live "now" point using the
      // in-memory portfolio + last tick price — otherwise the curve (and the P&L derived from its
      // last point) can lag well behind reality between decisions.
      const runtime = getSessionRuntimeSnapshot(session.id);
      const latestPersisted = equityCurve[equityCurve.length - 1];
      let curveForMetrics = equityCurve;
      let finalEquity = latestPersisted ? latestPersisted.equity : Number(session.initialQuoteBalance);
      if (runtime && runtime.lastPrice !== null) {
        finalEquity = runtime.quoteBalance + runtime.baseBalance * runtime.lastPrice;
        curveForMetrics = [...equityCurve, { timestamp: Date.now(), equity: finalEquity }];
      }

      const performance = computePerformanceMetrics({
        initialQuoteBalance: Number(session.initialQuoteBalance),
        finalEquity,
        equityCurve: curveForMetrics,
        trades,
        missedFillCount,
        granularity: "ONE_HOUR", // see file-level note — only used internally for drawdown math here, never surfaced
        periodStartMs: (session.startedAt ?? session.createdAt).getTime(),
        periodEndMs: Date.now(),
      });

      return {
        sessionId: session.id,
        mode: session.mode,
        status: session.status,
        strategy: { slug: session.strategyConfig.strategy.slug, name: session.strategyConfig.strategy.name },
        productId: session.productId,
        pnl: performance.totalPnl,
        winRatePct: performance.winRatePct,
        feesPaid,
        maxDrawdownPct: performance.maxDrawdownPct,
        completedCycles: performance.roundTripCount,
        equityCurve: curveForMetrics,
      };
    }),
  );

  res.json({ sessions: rows });
});

/**
 * GET /sessions/:id — full detail for one PAPER/LIVE session:
 * current price, equity, unrealized P&L, fills, fees paid, missed-fill log.
 *
 * "Open orders/levels" (as worded in PLAN.md/tasks-frontend.md) doesn't map
 * onto a DB concept in this codebase the way it might sound: every Order
 * this project ever creates resolves synchronously to FILLED or REJECTED
 * within the same tick (see `sessionManager.ts`'s `processDecisions` and
 * `orderExecutor.ts`) — nothing ever sits at `status: OPEN` waiting to be
 * filled later. The closest real equivalent is the strategy's own opaque
 * `strategyState` (e.g. grid's per-level state machine), which is returned
 * as-is, plus the most recent Order rows for an at-a-glance activity feed.
 */
sessionsRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id must be an integer" });
    return;
  }

  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      strategyConfig: { include: { strategy: true } },
      orders: { include: { fills: true }, orderBy: { createdAt: "desc" }, take: 50 },
      trades: { orderBy: { closedAt: "desc" }, take: 50 },
      missedFills: { orderBy: { occurredAt: "desc" }, take: 50 },
    },
  });
  if (!session || session.mode === "BACKTEST") {
    res.status(404).json({ error: `No PAPER/LIVE session with id ${id} (backtests are served via GET /backtests/:id)` });
    return;
  }

  const [latestBalance, feesAgg, closedBuyFillIds] = await Promise.all([
    prisma.balance.findFirst({ where: { sessionId: id }, orderBy: { timestamp: "desc" } }),
    prisma.fill.aggregate({ where: { order: { sessionId: id } }, _sum: { fee: true } }),
    prisma.trade.findMany({ where: { sessionId: id }, select: { buyFillId: true } }),
  ]);
  const closedBuyFillIdSet = new Set(closedBuyFillIds.map((t) => t.buyFillId));

  const runtime = getSessionRuntimeSnapshot(id);
  const quoteBalance = runtime ? runtime.quoteBalance : latestBalance ? Number(latestBalance.quoteBalance) : Number(session.initialQuoteBalance);
  const baseBalance = runtime ? runtime.baseBalance : latestBalance ? Number(latestBalance.baseBalance) : Number(session.initialBaseBalance);
  const currentPrice = runtime?.lastPrice ?? null;
  const equity = currentPrice !== null ? quoteBalance + baseBalance * currentPrice : latestBalance ? Number(latestBalance.equity) : quoteBalance;

  // Unrealized P&L = mark-to-market value of the currently-open (not-yet-sold) position minus what
  // was actually paid for it. "Open" here means: a FILLED BUY fill that no Trade row has closed yet
  // (Trade.buyFillId references exactly the fill it closed — see sessionManager.ts's cost-basis
  // logic). This deliberately queries ALL of the session's orders, not just the 50 most recent
  // included above, since an old open buy could otherwise be missed.
  const openBuyOrders = await prisma.order.findMany({
    where: { sessionId: id, side: "BUY", status: "FILLED" },
    include: { fills: true },
  });
  let openPositionCostBasis = 0;
  for (const order of openBuyOrders) {
    for (const fill of order.fills) {
      if (!closedBuyFillIdSet.has(fill.id)) openPositionCostBasis += Number(fill.price) * Number(fill.size);
    }
  }
  const unrealizedPnl = currentPrice !== null ? baseBalance * currentPrice - openPositionCostBasis : null;
  const realizedPnl = session.trades.reduce((sum, t) => sum + Number(t.pnl), 0); // only reflects the 50 most recent Trade rows fetched above

  res.json({
    id: session.id,
    mode: session.mode,
    status: session.status,
    productId: session.productId,
    strategy: { slug: session.strategyConfig.strategy.slug, name: session.strategyConfig.strategy.name },
    strategyConfigId: session.strategyConfig.id,
    startedAt: session.startedAt,
    stoppedAt: session.stoppedAt,
    error: session.error,
    // Live-Trading Safety Rails caps (null = no cap) — added for tasks-frontend.md Phase 6.7's
    // LIVE-session indicator; only meaningful when mode is LIVE, but harmless (always null) for PAPER.
    maxSpendPerOrder: session.maxSpendPerOrder !== null ? Number(session.maxSpendPerOrder) : null,
    maxPositionSize: session.maxPositionSize !== null ? Number(session.maxPositionSize) : null,
    isRunningInThisProcess: runtime !== null,
    currentPrice,
    quoteBalance,
    baseBalance,
    equity,
    unrealizedPnl,
    realizedPnl,
    feesPaid: Number(feesAgg._sum.fee ?? 0),
    strategyState: session.strategyState,
    recentOrders: session.orders.map(toOrderDto),
    recentTrades: session.trades.map(toTradeDto),
    missedFills: session.missedFills.map(toMissedFillDto),
  });
});

/**
 * POST /sessions — creates and immediately starts a new PAPER/LIVE session
 * (`createSession()` + `startSession()`). BACKTEST creation stays on
 * `POST /backtests`, which has different semantics (runs synchronously,
 * returns a finished report).
 */
sessionsRouter.post("/", async (req, res) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  const session = await createSession({
    mode: body.mode,
    strategyConfigId: body.strategyConfigId,
    productId: body.productId,
    initialQuoteBalance: body.initialQuoteBalance,
    initialBaseBalance: body.initialBaseBalance,
    feeScheduleOverride: body.feeScheduleOverride,
    maxSpendPerOrder: body.maxSpendPerOrder,
    maxPositionSize: body.maxPositionSize,
  });

  try {
    await startSession(session.id);
  } catch (error) {
    // The Session row was already created (PENDING) before startSession() ran — e.g. the
    // LIVE_TRADING_ENABLED gate, an unregistered strategy slug, or a paramsSchema mismatch throws
    // here. Mark it FAILED rather than leaving it stuck at PENDING forever with nothing explaining
    // why, matching the same FAILED-on-error pattern handleTick uses for a running session.
    await prisma.session.update({ where: { id: session.id }, data: { status: "FAILED", error: String(error) } }).catch(() => {});
    res.status(400).json({ error: error instanceof Error ? error.message : String(error), sessionId: session.id });
    return;
  }

  const started = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
  res.status(201).json({ sessionId: started.id, status: started.status });
});

/**
 * POST /sessions/:id/start — (re)starts an EXISTING session, e.g. resuming
 * one that's currently PAUSED. `startSession()` is idempotent and reloads
 * fresh from the DB regardless of current status (see its own doc comment),
 * so this is intentionally the exact same function `POST /sessions` and
 * `resumeRunningSessions()` both call — there is no separate "resume" path
 * to keep in sync with it.
 */
sessionsRouter.post("/:id/start", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id must be an integer" });
    return;
  }
  try {
    await startSession(id);
    const session = await prisma.session.findUniqueOrThrow({ where: { id } });
    res.json({ sessionId: id, status: session.status });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** POST /sessions/:id/stop — terminal; not meant to be resumed (see `stopSession()`'s own doc comment). */
sessionsRouter.post("/:id/stop", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id must be an integer" });
    return;
  }
  try {
    await stopSession(id);
    res.json({ sessionId: id, status: "STOPPED" });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** POST /sessions/:id/pause — resumable later via `POST /sessions/:id/start` (`strategyState` is already durable). */
sessionsRouter.post("/:id/pause", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "id must be an integer" });
    return;
  }
  try {
    await pauseSession(id);
    res.json({ sessionId: id, status: "PAUSED" });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
