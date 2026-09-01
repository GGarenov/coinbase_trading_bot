/**
 * The ONE place `web/` makes HTTP calls to the engine — see the `frontend`
 * skill's API-client-only rule. Nothing under `web/` should ever import
 * `@prisma/client` or reach into `data/bot.db` directly; every read and
 * write goes through a typed helper in this file instead, which in turn
 * only ever calls the engine's REST API (see `docs/tasks-backend.md`'s
 * "HTTP API — Strategy & Session Routes" section for what's on the other
 * end of these calls).
 *
 * Response shapes here mirror `engine/src/routes/*.ts` by hand — there's no
 * shared-types codegen link between them (the engine's route handlers
 * return ad-hoc JSON, not a type exported from `packages/shared`). Keep
 * these in sync manually if a route's response shape changes.
 *
 * DOES import `packages/shared`'s domain-enum/`FeeSchedule` types (the
 * bare `@coinbase-trading-bot/shared` specifier, never `.../server`) —
 * confirmed safe to bundle here: that package's `package.json` declares an
 * `exports` map where `.` resolves only to `src/index.ts` (types, the
 * domain enums, `fees.ts`, the pure strategy definitions — none of which
 * import `@prisma/client`/`better-sqlite3`), and `./server` — the ONLY
 * subpath that re-exports the real, DB-connected `prisma` client — isn't
 * even resolvable through the bare specifier. `web/`'s bundler physically
 * cannot reach Prisma through this import. See `packages/shared/src/server.ts`'s
 * own doc comment for the full reasoning.
 */
import type { FeeSchedule, Liquidity, OrderStatus, OrderSide, OrderTypeHint, SessionMode, SessionStatus } from "@coinbase-trading-bot/shared";

// ---------------------------------------------------------------------------
// Base fetch wrapper (Phase 2.1)
// ---------------------------------------------------------------------------

/**
 * Must be `NEXT_PUBLIC_`-prefixed: this module is called from client
 * components (the session detail/compare views poll from the browser, per
 * the frontend skill), where only `NEXT_PUBLIC_*` env vars are available.
 * Defaults to the engine's own default `ENGINE_PORT` (4000) on localhost —
 * see `web/.env.example`.
 */
const ENGINE_URL = (process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://127.0.0.1:4000").replace(/\/+$/, "");

/**
 * Thrown for any non-2xx engine response — never a silent throw of a raw
 * `Response` or a generic `Error`. `details` carries the parsed JSON error
 * body when there is one (e.g. a route's `{ error, details }` shape from a
 * failed zod validation), so a caller that wants field-level messages can
 * get them without re-parsing anything.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function hasStringField<K extends string>(value: unknown, key: K): value is Record<K, string> {
  return typeof value === "object" && value !== null && key in value && typeof (value as Record<string, unknown>)[key] === "string";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch (cause) {
    // The engine process itself is unreachable (not running, wrong port, network error) —
    // distinguished from an ApiError (the engine responded, just with a non-2xx status) so a
    // caller can tell "engine is down" apart from "the engine rejected this request".
    throw new ApiError(0, `Could not reach the engine at ${ENGINE_URL}${path}`, cause);
  }

  const raw = await res.text();
  const body: unknown = raw ? safeJsonParse(raw) : null;

  if (!res.ok) {
    const message = hasStringField(body, "error") ? body.error : `Request to ${path} failed with status ${res.status}`;
    throw new ApiError(res.status, message, body);
  }
  return body as T;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // not JSON — shouldn't happen against this engine, but don't crash the caller over it
  }
}

function get<T>(path: string): Promise<T> {
  return request<T>(path, { method: "GET" });
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
}

// ---------------------------------------------------------------------------
// Shared wire-format types
// ---------------------------------------------------------------------------

/**
 * The engine's `OrderType` Prisma enum is exposed from `packages/shared`
 * under the name `OrderTypeHint` (it doubles as the hint a strategy's
 * `TradeDecision` carries) — re-exported here under the more DTO-natural
 * name for anything reading an `Order` row's `type` field.
 */
export type OrderType = OrderTypeHint;
export type { FeeSchedule, Liquidity, OrderStatus, OrderSide, SessionMode, SessionStatus };

export interface StrategyRef {
  slug: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Strategies (Phase 2.2) — GET /strategies, GET /strategies/:slug
// ---------------------------------------------------------------------------

export interface StrategyCatalogEntry {
  id: number;
  slug: string;
  name: string;
  description: string;
  riskLevel: string;
  /** Opaque — shape is strategy-specific, validated server-side by the strategy's own `paramsSchema`. */
  defaultParams: unknown;
  /**
   * JSON Schema for the strategy's params, generated server-side from its
   * actual Zod schema (`z.toJSONSchema()`) — see `routes/strategies.ts`.
   * `null` only if a DB row exists with no matching registry entry (a
   * misconfigured deploy, not a normal state). Drives Phase 4.2's dynamic
   * config form; can never drift from what the engine actually validates,
   * since it's generated from that exact schema object.
   */
  paramsSchema: Record<string, unknown> | null;
}

export function getStrategies(): Promise<StrategyCatalogEntry[]> {
  return get<StrategyCatalogEntry[]>("/strategies");
}

export function getStrategy(slug: string): Promise<StrategyCatalogEntry> {
  return get<StrategyCatalogEntry>(`/strategies/${encodeURIComponent(slug)}`);
}

// ---------------------------------------------------------------------------
// Sessions: list + detail (Phase 2.3) — GET /sessions, GET /sessions/:id
// ---------------------------------------------------------------------------

export interface SessionSummary {
  id: number;
  mode: SessionMode;
  status: SessionStatus;
  productId: string;
  strategy: StrategyRef;
  strategyConfigId: number;
  strategyConfigName: string;
  /** ISO date-time strings, or null — this is JSON, not revived `Date` objects; parse with `new Date(...)` at the point of use. */
  startedAt: string | null;
  stoppedAt: string | null;
  createdAt: string;
  error: string | null;
}

/** Only PAPER/LIVE sessions — BACKTEST sessions live under `/backtests` (see `getBacktest`), a different response shape entirely. */
export function getSessions(params?: { mode?: "PAPER" | "LIVE" }): Promise<SessionSummary[]> {
  const query = params?.mode ? `?mode=${params.mode}` : "";
  return get<SessionSummary[]>(`/sessions${query}`);
}

export interface FillDto {
  id: number;
  price: number;
  size: number;
  fee: number;
  feeRate: number;
  liquidity: Liquidity;
  timestamp: string;
}

export interface OrderDto {
  id: number;
  side: OrderSide;
  type: OrderType;
  price: number | null;
  stopPrice: number | null;
  size: number | null;
  status: OrderStatus;
  exchangeOrderId: string | null;
  levelPrice: number | null;
  rejectionReason: string | null;
  createdAt: string;
  filledAt: string | null;
  fills: FillDto[];
}

export interface TradeDto {
  id: number;
  buyFillId: number;
  sellFillId: number;
  costBasis: number;
  proceeds: number;
  feesTotal: number;
  pnl: number;
  openedAt: string;
  closedAt: string;
}

export interface MissedFillDto {
  id: number;
  levelPrice: number;
  side: OrderSide;
  reason: string;
  occurredAt: string;
}

export interface SessionDetail {
  id: number;
  mode: SessionMode;
  status: SessionStatus;
  productId: string;
  strategy: StrategyRef;
  strategyConfigId: number;
  startedAt: string | null;
  stoppedAt: string | null;
  error: string | null;
  /** Whether THIS engine process currently has the session subscribed and ticking — false doesn't necessarily mean "not running" if a different engine process/restart is involved, only that live fields below fell back to the last persisted `Balance` row. */
  isRunningInThisProcess: boolean;
  /** Live tick price when `isRunningInThisProcess`; otherwise null (no live feed to report from). */
  currentPrice: number | null;
  quoteBalance: number;
  baseBalance: number;
  equity: number;
  /** Mark-to-market P&L on the currently-open (not yet sold) position; null when `currentPrice` is null (nothing to mark against). */
  unrealizedPnl: number | null;
  /** Sum of the (at most 50 most recent) `recentTrades` below — not a full-session total if there are more than 50 closed round trips. */
  realizedPnl: number;
  /** Sum of ALL fees for this session (not capped at 50, unlike the arrays below). */
  feesPaid: number;
  /**
   * The strategy's own opaque state snapshot (e.g. grid's per-level state
   * machine). This — plus `recentOrders` below — is this route's real
   * substitute for "open orders/levels": no `Order` in this codebase ever
   * sits at `status: "OPEN"`, every one resolves to `FILLED`/`REJECTED`
   * synchronously within the tick that created it. Render from these two
   * fields, not from an order status that will never appear.
   */
  strategyState: unknown;
  /** Up to 50 most recent orders, newest first. */
  recentOrders: OrderDto[];
  /** Up to 50 most recent completed round trips, newest first. */
  recentTrades: TradeDto[];
  /** Up to 50 most recent missed-fill events, newest first. */
  missedFills: MissedFillDto[];
}

/** Throws `ApiError` with `status: 404` for a BACKTEST session id — use `getBacktest` for those instead. */
export function getSession(id: number): Promise<SessionDetail> {
  return get<SessionDetail>(`/sessions/${id}`);
}

// ---------------------------------------------------------------------------
// Sessions: control actions (Phase 2.4) — POST /sessions[/:id/start|stop|pause]
// ---------------------------------------------------------------------------

export interface CreateSessionInput {
  strategyConfigId: number;
  productId: string;
  /** BACKTEST isn't accepted here — use `createBacktest` instead, a different flow entirely (runs synchronously, returns a finished report). */
  mode: "PAPER" | "LIVE";
  initialQuoteBalance: number;
  initialBaseBalance?: number;
  feeScheduleOverride?: FeeSchedule;
  /** Live-Trading Safety Rails caps — see the `backend` skill. Strongly recommended for any `mode: "LIVE"` session; the Phase 4.6 "start live session" confirmation step is where the dashboard should actually prompt for these, not leave them defaulted. */
  maxSpendPerOrder?: number;
  maxPositionSize?: number;
}

export interface SessionActionResult {
  sessionId: number;
  status: SessionStatus;
}

/** Creates AND starts a new PAPER/LIVE session in one call. On failure after creation (e.g. the LIVE_TRADING_ENABLED gate), the engine marks the session FAILED and this rejects with an `ApiError` whose `details` includes `sessionId` — the row still exists, for the audit trail, even though it never ran. */
export function createSession(input: CreateSessionInput): Promise<SessionActionResult> {
  return post<SessionActionResult>("/sessions", input);
}

/** (Re)starts an existing session — the same call whether it's the first start after `createSession` or resuming one that's currently PAUSED. */
export function startSession(id: number): Promise<SessionActionResult> {
  return post<SessionActionResult>(`/sessions/${id}/start`);
}

/** Terminal — a stopped session is not meant to be resumed. Use `pauseSession` if resuming later is the intent. */
export function stopSession(id: number): Promise<SessionActionResult> {
  return post<SessionActionResult>(`/sessions/${id}/stop`);
}

/** Resumable later via `startSession`. */
export function pauseSession(id: number): Promise<SessionActionResult> {
  return post<SessionActionResult>(`/sessions/${id}/pause`);
}

// ---------------------------------------------------------------------------
// Sessions: comparison metrics (Phase 2.6) — GET /sessions/compare
// ---------------------------------------------------------------------------

export interface EquitySample {
  /** ms epoch, NOT an ISO string — matches `backtestAnalytics.ts`'s `EquitySample` on the engine side, unlike every date field elsewhere in this file. */
  timestamp: number;
  equity: number;
}

export interface SessionCompareRow {
  sessionId: number;
  mode: SessionMode;
  status: SessionStatus;
  strategy: StrategyRef;
  productId: string;
  pnl: number;
  /** null when the session has zero completed round trips yet. */
  winRatePct: number | null;
  feesPaid: number;
  maxDrawdownPct: number;
  completedCycles: number;
  /** Includes a live "now" point appended when the session is actively running in this process — see `routes/sessions.ts`. */
  equityCurve: EquitySample[];
}

/**
 * Every PAPER/LIVE session (any status, not just running ones), for
 * `compare/page.tsx`'s table + equity-curve overlay. Deliberately has no
 * `sharpeRatio`/`sortinoRatio` fields — see `routes/sessions.ts`'s own doc
 * comment: a paper/live equity curve is only sampled on decisions, not on a
 * fixed grid, so annualizing it the way a backtest's evenly-spaced curve
 * allows would produce numbers that look precise but aren't.
 */
export async function getSessionsCompare(): Promise<SessionCompareRow[]> {
  const { sessions } = await get<{ sessions: SessionCompareRow[] }>("/sessions/compare");
  return sessions;
}

// ---------------------------------------------------------------------------
// Backtests (Phase 2.5) — POST /backtests, GET /backtests/:id
// ---------------------------------------------------------------------------

export interface PerformanceMetrics {
  totalReturnPct: number;
  totalPnl: number;
  /** null when the backtest period is under a day. */
  cagrPct: number | null;
  maxDrawdownPct: number;
  maxDrawdownDurationDays: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  winRatePct: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  roundTripCount: number;
  averageTradeDurationDays: number | null;
  missedFillCount: number;
}

export interface BacktestTradeRecord {
  costBasis: number;
  proceeds: number;
  feesTotal: number;
  pnl: number;
  /** ms epoch, matching `EquitySample` above — a backtest report's internal timestamps are all ms-epoch numbers, not ISO strings. */
  openedAt: number;
  closedAt: number;
}

export interface BacktestMissedFillRecord {
  levelPrice: number;
  side: OrderSide;
  reason: string;
  occurredAt: number;
}

export interface BacktestReport {
  performance: PerformanceMetrics;
  equityCurve: EquitySample[];
  trades: BacktestTradeRecord[];
  missedFills: BacktestMissedFillRecord[];
  /** Populated when another backtest already ran the same strategy over this exact historical window with different parameters. */
  curveFittingWarning: string | null;
}

export interface CreateBacktestInput {
  strategyConfigId: number;
  productId: string;
  /** ISO date-time strings. */
  startDate: string;
  endDate: string;
  initialQuoteBalance: number;
  initialBaseBalance?: number;
  feeScheduleOverride?: FeeSchedule;
}

export interface BacktestResult {
  sessionId: number;
  status: SessionStatus;
  report: BacktestReport;
}

/** Runs SYNCHRONOUSLY within the request on the engine side — expect this call to take as long as the backtest itself (fine for day-to-few-months hourly windows; see `routes/backtests.ts`'s own scope note). */
export function createBacktest(input: CreateBacktestInput): Promise<BacktestResult> {
  return post<BacktestResult>("/backtests", input);
}

export interface BacktestSummary {
  sessionId: number;
  status: SessionStatus;
  productId: string;
  startDate: string | null;
  endDate: string | null;
  error: string | null;
  /** Null if the backtest hasn't completed (shouldn't normally be observed, since `createBacktest` only returns after completion) or failed before producing a report. */
  report: BacktestReport | null;
}

export function getBacktest(id: number): Promise<BacktestSummary> {
  return get<BacktestSummary>(`/backtests/${id}`);
}
