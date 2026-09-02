import type {
  FeeSchedule,
  PortfolioState,
  PricePoint,
  SessionMode,
  StrategyInstance,
  TradeDecision,
} from "@coinbase-trading-bot/shared";
import { getStrategyDefinition } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { executeOrder } from "../exchange/coinbase/orderExecutor";
import type { ProductInfo } from "../exchange/coinbase/rest";
import { fetchProductInfo } from "../exchange/coinbase/rest";
import { PriceStream } from "../exchange/coinbase/stream";
import { checkLiveSafety } from "./liveSafetyGuard";
import { recordMissedFill } from "./missedFillTracker";
import { applyFillToPortfolio, type OrderDecision, simulateFill } from "./simulation";

/**
 * One shared, refcounted `PriceStream` for every paper/live session this
 * process runs — this is what lets many sessions on the same product go
 * through a single WebSocket connection instead of one-per-session (see
 * `stream.ts`'s own doc comment). Exported so a test can inspect
 * `subscribedProductCount`/`totalListenerCount` to verify the sharing
 * actually happens.
 */
export const priceStream = new PriceStream();

/**
 * The minimal shape `processDecisions` needs to book a tick's decisions.
 * `RunningSession` (paper/live, driven by `priceStream`) and
 * `backtestRunner.ts`'s throwaway per-run context both satisfy this shape,
 * so the exact same booking logic runs whether decisions came from a real
 * tick or a historical candle — paper and backtest can't silently drift
 * apart in how a fill is decided or recorded.
 */
export interface DecisionProcessingContext {
  sessionId: number;
  mode: SessionMode;
  strategy: StrategyInstance;
  feeSchedule: FeeSchedule;
  /** Only ever set for LIVE sessions — `executeOrder` needs it to round/validate order size. */
  productInfo: ProductInfo | null;
  /** Mutated in place by `processDecisions` as fills are applied. */
  portfolio: PortfolioState;
  /** Live-Trading Safety Rails — only enforced when `mode === "LIVE"`; null = no cap. See `liveSafetyGuard.ts`. */
  maxSpendPerOrder: number | null;
  maxPositionSize: number | null;
}

interface RunningSession extends DecisionProcessingContext {
  unsubscribe: () => void;
  /** Guards against a tick arriving while the previous tick's DB transaction is still in flight. A skipped tick is harmless — the next one carries the same state forward. */
  processing: boolean;
  /**
   * Most recent tick price, updated on every tick regardless of `processing`
   * or whether a decision fired — purely informational (drives `GET
   * /sessions/:id`'s live current-price/equity display), never read by the
   * booking logic itself. `null` until the first tick arrives after start.
   */
  lastPrice: number | null;
}

const runningSessions = new Map<number, RunningSession>();

interface ResolvedFill {
  price: number;
  size: number;
  fee: number;
  feeRate: number;
  liquidity: "MAKER" | "TAKER";
  exchangeOrderId: string | null;
  timestampMs: number;
}

async function resolveFill(ctx: DecisionProcessingContext, decision: OrderDecision, point: PricePoint): Promise<ResolvedFill> {
  if (ctx.mode === "LIVE") {
    if (!ctx.productInfo) throw new Error(`LIVE session ${ctx.sessionId} has no productInfo cached — startSession should have fetched it`);
    const live = await executeOrder(decision, point.price, ctx.productInfo, ctx.feeSchedule);
    return { ...live, exchangeOrderId: live.exchangeOrderId, timestampMs: live.timestamp };
  }
  const sim = simulateFill(decision, point.price, ctx.feeSchedule);
  return { ...sim, exchangeOrderId: null, timestampMs: point.timestamp };
}

/**
 * Books one tick's decisions: resolves every ORDER decision to a fill
 * (live orders are placed OUTSIDE the DB transaction below, since a slow or
 * flaky network call has no business holding a SQLite write lock open),
 * updates `ctx.portfolio` in memory, then writes the resulting
 * Order/Fill/Trade/MissedFill rows plus the strategy's updated state
 * snapshot and a Balance row inside ONE transaction, per the task's
 * "per-tick persistence... inside one Prisma transaction" requirement.
 */
export async function processDecisions(ctx: DecisionProcessingContext, decisions: TradeDecision[], point: PricePoint): Promise<void> {
  const resolved: Array<{ decision: OrderDecision; fill: ResolvedFill }> = [];
  const rejected: Array<{ decision: OrderDecision; reason: string }> = [];
  const missed: Array<Extract<TradeDecision, { kind: "MISSED_FILL" }>> = [];

  for (const decision of decisions) {
    if (decision.kind === "MISSED_FILL") {
      missed.push(decision);
      continue;
    }
    if (ctx.mode === "LIVE") {
      const safety = await checkLiveSafety(
        decision,
        ctx.portfolio,
        { maxSpendPerOrder: ctx.maxSpendPerOrder, maxPositionSize: ctx.maxPositionSize },
        point.price,
      );
      if (!safety.allowed) {
        // No fill, no portfolio change — that's the entire point of the safety check. Still
        // persisted below (as a REJECTED Order) so a full audit trail exists even for decisions
        // that never reached the exchange.
        rejected.push({ decision, reason: safety.reason });
        continue;
      }
    }
    const fill = await resolveFill(ctx, decision, point);
    ctx.portfolio = applyFillToPortfolio(ctx.portfolio, decision.side, fill);
    resolved.push({ decision, fill });
  }

  await prisma.$transaction(async (tx) => {
    for (const { decision, reason } of rejected) {
      await tx.order.create({
        data: {
          sessionId: ctx.sessionId,
          side: decision.side,
          type: decision.orderType,
          // Best-effort/informational only — this order was never priced or sized against the
          // exchange, since it never got there. `size` stays null for a BUY (only quoteAmount is
          // known); a SELL's `quantity` is known exactly, so it's recorded.
          price: decision.levelPrice ?? null,
          size: decision.side === "SELL" ? decision.quantity : null,
          status: "REJECTED",
          rejectionReason: reason,
          levelPrice: decision.levelPrice ?? null,
        },
      });
    }

    for (const { decision, fill } of resolved) {
      const order = await tx.order.create({
        data: {
          sessionId: ctx.sessionId,
          side: decision.side,
          type: decision.orderType,
          price: fill.price,
          size: fill.size,
          status: "FILLED",
          exchangeOrderId: fill.exchangeOrderId,
          levelPrice: decision.levelPrice ?? null,
          filledAt: new Date(fill.timestampMs),
        },
      });
      const fillRow = await tx.fill.create({
        data: {
          orderId: order.id,
          price: fill.price,
          size: fill.size,
          fee: fill.fee,
          feeRate: fill.feeRate,
          liquidity: fill.liquidity,
          timestamp: new Date(fill.timestampMs),
        },
      });

      if (decision.side === "SELL") {
        // Every strategy that can sell reports the exact BUY level it's closing via
        // `closingLevelPrice` — grid is the only one that sells today, and pairs BUY/SELL levels by
        // declaration order (not price adjacency), so its `closingLevelPrice` is the paired BUY
        // level's price, which is NOT the same as `levelPrice` (the SELL's own trigger/execution
        // level — see the TradeDecision doc comment). The most recent BUY order at that level for
        // this session IS the position being closed — no FIFO matching across the session's whole
        // fill history needed.
        //
        // ⚠️ Real bug, fixed 2026-09-02 (found via tasks-qa.md's Phase 3): this used to look up by
        // `decision.levelPrice` — grid's SELL decisions set that to the SELL level's OWN price
        // (correctly, since orderExecutor.ts/simulation.ts need it as the execution price), which is
        // a DIFFERENT number from the BUY level being closed. The lookup below therefore never found
        // a match for any grid round trip, ever — money/equity were still correct (Order/Fill
        // persisted regardless), but no Trade row was ever created, so win rate/profit factor/round
        // trip count silently stayed null/zero for every grid session in this project's history.
        const buyOrder = await tx.order.findFirst({
          where: { sessionId: ctx.sessionId, side: "BUY", levelPrice: decision.closingLevelPrice ?? undefined },
          orderBy: { createdAt: "desc" },
          include: { fills: true },
        });
        const buyFill = buyOrder?.fills[0];
        if (buyFill && buyOrder) {
          const proceeds = fill.price * fill.size;
          const feesTotal = Number(buyFill.fee) + fill.fee;
          const pnl = proceeds - feesTotal - decision.costBasis;
          await tx.trade.create({
            data: {
              sessionId: ctx.sessionId,
              buyFillId: buyFill.id,
              sellFillId: fillRow.id,
              costBasis: decision.costBasis,
              proceeds,
              feesTotal,
              pnl,
              openedAt: buyOrder.filledAt ?? buyOrder.createdAt,
              closedAt: new Date(fill.timestampMs),
            },
          });
        } else {
          // Not expected in normal operation (grid's own per-level state machine guarantees a BUY
          // precedes its SELL), but if it ever happens — e.g. a resumed session missing history —
          // fail loudly rather than silently fabricate a Trade row with an unknown buy-side fee.
          // The Order/Fill above are still persisted either way, so the money itself is accounted for.
          console.warn(
            `[sessionManager] session ${ctx.sessionId}: SELL closing BUY level ${decision.closingLevelPrice} has no matching BUY fill on record — Order/Fill were persisted, but no Trade round-trip row was created`,
          );
        }
      }
    }

    for (const decision of missed) {
      await recordMissedFill(tx, ctx.sessionId, decision, point.timestamp);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- strategyState is an opaque Json snapshot, not worth typing per-strategy here
    await tx.session.update({ where: { id: ctx.sessionId }, data: { strategyState: ctx.strategy.getState() as any } });
    await tx.balance.create({
      data: {
        sessionId: ctx.sessionId,
        timestamp: new Date(point.timestamp),
        quoteBalance: ctx.portfolio.quoteBalance,
        baseBalance: ctx.portfolio.baseBalance,
        equity: ctx.portfolio.quoteBalance + ctx.portfolio.baseBalance * point.price,
      },
    });
  });
}

async function loadPortfolio(sessionId: number, initialQuote: number, initialBase: number): Promise<PortfolioState> {
  const latest = await prisma.balance.findFirst({ where: { sessionId }, orderBy: { timestamp: "desc" } });
  if (!latest) return { quoteBalance: initialQuote, baseBalance: initialBase };
  return { quoteBalance: Number(latest.quoteBalance), baseBalance: Number(latest.baseBalance) };
}

async function handleTick(sessionId: number, point: PricePoint): Promise<void> {
  const ctx = runningSessions.get(sessionId);
  if (!ctx) return;
  ctx.lastPrice = point.price; // updated even on a skipped (overlapping) tick — display-only, safe to be a tick stale
  if (ctx.processing) return;
  ctx.processing = true;
  try {
    const decisions = ctx.strategy.onPrice(point, ctx.portfolio);
    if (decisions.length > 0) {
      await processDecisions(ctx, decisions, point);
    } else {
      // No trade this tick, but a strategy's internal state can still have changed (e.g. grid's
      // `lastPrice`) — persist it every tick anyway, not just when a decision fires. Only writing
      // state alongside decisions would leave a stale snapshot on resume-after-crash: a level
      // crossing that happened between the last recorded decision and the actual last tick before
      // the crash could be missed or double-counted on restart.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await prisma.session.update({ where: { id: sessionId }, data: { strategyState: ctx.strategy.getState() as any } });
    }
  } catch (error) {
    console.error(`[sessionManager] session ${sessionId}: error handling tick`, error);
    await prisma.session
      .update({ where: { id: sessionId }, data: { status: "FAILED", error: String(error) } })
      .catch(() => {});
    await stopSession(sessionId).catch(() => {});
  } finally {
    ctx.processing = false;
  }
}

/**
 * Starts (or resumes) a session: loads it and its strategy config from the
 * DB, constructs the strategy instance via the registry, restores any
 * persisted `strategyState`, and subscribes to the shared `priceStream` for
 * its product. Idempotent — calling it on an already-running session is a
 * no-op, which is what lets `resumeRunningSessions()` reuse it directly.
 */
export async function startSession(sessionId: number): Promise<void> {
  if (runningSessions.has(sessionId)) return;

  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { strategyConfig: { include: { strategy: true } } },
  });

  if (session.mode === "LIVE" && process.env.LIVE_TRADING_ENABLED !== "true") {
    // A minimal, early piece of docs/tasks-backend.md's "Live-Trading Safety Rails" section —
    // NOT a substitute for it. The full spend-cap/kill-switch/audit-trail work is still pending;
    // this check only exists so this pass can't accidentally place a real order while building
    // and testing the paper-trading path.
    throw new Error(
      `Refusing to start session ${sessionId}: mode is LIVE but LIVE_TRADING_ENABLED is not set to "true" on this process.`,
    );
  }

  const definition = getStrategyDefinition(session.strategyConfig.strategy.slug);
  if (!definition) throw new Error(`Unknown strategy slug: ${session.strategyConfig.strategy.slug}`);
  const params = definition.paramsSchema.parse(session.strategyConfig.params);

  // Anchored to the session's own persisted startedAt, not process/engine start time, so
  // schedule-based strategies (DCA) compute correct absolute buy times across a restart. Written
  // to the DB immediately on first start and never changed again.
  const startedAtMs = session.startedAt ? session.startedAt.getTime() : Date.now();

  const strategy = definition.create(params, startedAtMs);
  if (session.strategyState != null) strategy.setState(session.strategyState);

  const feeSchedule = session.feeSchedule as unknown as FeeSchedule;
  const portfolio = await loadPortfolio(sessionId, Number(session.initialQuoteBalance), Number(session.initialBaseBalance));
  const productInfo = session.mode === "LIVE" ? await fetchProductInfo(session.productId) : null;

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: "RUNNING", startedAt: session.startedAt ?? new Date(startedAtMs) },
  });

  const runningSession: RunningSession = {
    sessionId,
    mode: session.mode as SessionMode,
    strategy,
    feeSchedule,
    productInfo,
    portfolio,
    maxSpendPerOrder: session.maxSpendPerOrder !== null ? Number(session.maxSpendPerOrder) : null,
    maxPositionSize: session.maxPositionSize !== null ? Number(session.maxPositionSize) : null,
    processing: false,
    lastPrice: null,
    unsubscribe: () => {},
  };
  runningSession.unsubscribe = priceStream.subscribe(session.productId, (point) => {
    void handleTick(sessionId, point);
  });

  runningSessions.set(sessionId, runningSession);
}

/** Unsubscribes from the price stream and marks the session STOPPED — a terminal state (unlike PAUSED, not meant to be resumed). */
export async function stopSession(sessionId: number): Promise<void> {
  const ctx = runningSessions.get(sessionId);
  if (ctx) {
    ctx.unsubscribe();
    runningSessions.delete(sessionId);
  }
  await prisma.session.update({ where: { id: sessionId }, data: { status: "STOPPED", stoppedAt: new Date() } });
}

/** Unsubscribes from the price stream and marks the session PAUSED — resumable later via `startSession`, since `strategyState` is already durable. */
export async function pauseSession(sessionId: number): Promise<void> {
  const ctx = runningSessions.get(sessionId);
  if (ctx) {
    ctx.unsubscribe();
    runningSessions.delete(sessionId);
  }
  await prisma.session.update({ where: { id: sessionId }, data: { status: "PAUSED" } });
}

/**
 * Reloads every `Session` row left `RUNNING` (i.e. the engine crashed or
 * was restarted without a clean stop/pause) and re-subscribes each — this
 * is what makes a crash never silently drop a running paper/live session.
 * Call once on engine boot, immediately after `app.listen()`.
 */
export async function resumeRunningSessions(): Promise<void> {
  const sessions = await prisma.session.findMany({ where: { status: "RUNNING" } });
  for (const session of sessions) {
    try {
      await startSession(session.id);
    } catch (error) {
      console.error(`[sessionManager] failed to resume session ${session.id}:`, error);
      await prisma.session
        .update({ where: { id: session.id }, data: { status: "FAILED", error: String(error) } })
        .catch(() => {});
    }
  }
}

/** Session IDs currently subscribed and receiving ticks in this process — for a health check or a test. */
export function getRunningSessionIds(): number[] {
  return Array.from(runningSessions.keys());
}

/** Live in-memory state for a session actively running in this process — the source of truth for a current price/equity display, which is always more current than the last persisted `Balance` row (only written when a decision actually fires, not every tick). `null` if the session isn't running here (stopped, paused, failed, or not yet resumed). */
export interface SessionRuntimeSnapshot {
  lastPrice: number | null;
  quoteBalance: number;
  baseBalance: number;
}
export function getSessionRuntimeSnapshot(sessionId: number): SessionRuntimeSnapshot | null {
  const ctx = runningSessions.get(sessionId);
  if (!ctx) return null;
  return { lastPrice: ctx.lastPrice, quoteBalance: ctx.portfolio.quoteBalance, baseBalance: ctx.portfolio.baseBalance };
}
