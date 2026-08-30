import type { Granularity } from "@coinbase-trading-bot/shared";

/**
 * Statistical helpers (drawdown, Sharpe, Sortino, CAGR) ported near-verbatim
 * from the earlier Binance-based iteration's `backtestAnalytics.ts` — this
 * math is exchange-agnostic and unchanged. Round-trip stats are NOT ported
 * from there, though: that version FIFO-matched sells to buys itself (the
 * documented cost-basis bug this project fixes — see `strategies/types.ts`).
 * Here, every completed round trip already exists as an exact `Trade` row
 * (linked to the specific buy it closes, via `costBasis`/`levelPrice`), so
 * this module just reads `Trade` rows directly instead of re-deriving them.
 */

export interface EquitySample {
  timestamp: number;
  equity: number;
}

export interface TradeRecord {
  costBasis: number;
  proceeds: number;
  feesTotal: number;
  pnl: number;
  openedAt: number;
  closedAt: number;
}

export interface MissedFillRecord {
  levelPrice: number;
  side: "BUY" | "SELL";
  reason: string;
  occurredAt: number;
}

export interface PerformanceMetrics {
  /** Total return over the backtest period, percent (e.g. 5.25 = +5.25%). */
  totalReturnPct: number;
  /** Absolute profit/loss in quote currency. */
  totalPnl: number;
  /** Compound annual growth rate, percent. null when the period is under a day. */
  cagrPct: number | null;
  /** Peak-to-trough decline on the equity curve, percent (positive number). */
  maxDrawdownPct: number;
  /** Longest drawdown from peak to recovery, in days. */
  maxDrawdownDurationDays: number;
  /** Per-period Sharpe ratio, annualized to the backtest's own candle granularity. Risk-free rate assumed 0. */
  sharpeRatio: number | null;
  /** Per-period Sortino ratio, annualized. Risk-free rate assumed 0. */
  sortinoRatio: number | null;
  /** Share of profitable round trips (Trade rows), percent. null when there are none. */
  winRatePct: number | null;
  /** Gross profit / gross loss across round trips. null when there are no losses. */
  profitFactor: number | null;
  /** Average net P&L of winning round trips, quote currency. */
  averageWin: number | null;
  /** Average net P&L of losing round trips (negative number). */
  averageLoss: number | null;
  /** Completed buy->sell round trips (`Trade` rows). */
  roundTripCount: number;
  /** Mean round-trip holding time in days. null when there are no round trips. */
  averageTradeDurationDays: number | null;
  /** Grid levels crossed with no fill (`MissedFill` rows) — an instance count, not a P&L figure. */
  missedFillCount: number;
}

export interface AnalyticsInput {
  initialQuoteBalance: number;
  finalEquity: number;
  /** Ordered by timestamp ascending. */
  equityCurve: EquitySample[];
  trades: TradeRecord[];
  missedFillCount: number;
  /** Determines how per-period returns are annualized for Sharpe/Sortino. */
  granularity: Granularity;
  periodStartMs: number;
  periodEndMs: number;
}

export interface BacktestReport {
  performance: PerformanceMetrics;
  equityCurve: EquitySample[];
  trades: TradeRecord[];
  missedFills: MissedFillRecord[];
  /**
   * Populated when other backtests already ran the same strategy over this
   * exact historical window with different parameters — see
   * `curveFittingCheck.ts`. `null` when there's nothing to warn about.
   */
  curveFittingWarning: string | null;
}

const MS_PER_DAY = 86_400_000;

const GRANULARITY_PERIODS_PER_YEAR: Record<Granularity, number> = {
  ONE_HOUR: 24 * 365,
  SIX_HOUR: 4 * 365,
  ONE_DAY: 365,
};

interface DrawdownStats {
  maxDrawdownPct: number;
  maxDrawdownDurationDays: number;
}

function computeDrawdown(equityCurve: EquitySample[]): DrawdownStats {
  if (equityCurve.length === 0) return { maxDrawdownPct: 0, maxDrawdownDurationDays: 0 };

  let peak = equityCurve[0].equity;
  let peakTime = equityCurve[0].timestamp;
  let maxDrawdownPct = 0;
  let maxDurationMs = 0;
  let currentDrawdownStart: number | null = null;

  for (const sample of equityCurve) {
    if (sample.equity >= peak) {
      if (currentDrawdownStart !== null) {
        maxDurationMs = Math.max(maxDurationMs, sample.timestamp - currentDrawdownStart);
        currentDrawdownStart = null;
      }
      peak = sample.equity;
      peakTime = sample.timestamp;
    } else {
      if (currentDrawdownStart === null) currentDrawdownStart = peakTime;
      const dd = peak > 0 ? ((peak - sample.equity) / peak) * 100 : 0;
      maxDrawdownPct = Math.max(maxDrawdownPct, dd);
    }
  }

  if (currentDrawdownStart !== null) {
    const last = equityCurve[equityCurve.length - 1];
    maxDurationMs = Math.max(maxDurationMs, last.timestamp - currentDrawdownStart);
  }

  return { maxDrawdownPct, maxDrawdownDurationDays: maxDurationMs / MS_PER_DAY };
}

function periodReturns(equityCurve: EquitySample[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  return returns;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function annualizedSharpe(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null;
  const s = stdDev(returns);
  if (s === 0) return null;
  return (mean(returns) / s) * Math.sqrt(periodsPerYear);
}

function annualizedSortino(returns: number[], periodsPerYear: number): number | null {
  if (returns.length < 2) return null;
  const downside = returns.filter((r) => r < 0);
  if (downside.length === 0) return null;
  const downsideDev = Math.sqrt(mean(downside.map((r) => r ** 2)));
  if (downsideDev === 0) return null;
  return (mean(returns) / downsideDev) * Math.sqrt(periodsPerYear);
}

function cagr(initial: number, final: number, periodMs: number): number | null {
  if (periodMs < MS_PER_DAY || initial <= 0 || final <= 0) return null;
  const years = periodMs / (365.25 * MS_PER_DAY);
  return (Math.pow(final / initial, 1 / years) - 1) * 100;
}

export function computePerformanceMetrics(input: AnalyticsInput): PerformanceMetrics {
  const totalReturnPct =
    input.initialQuoteBalance > 0 ? ((input.finalEquity - input.initialQuoteBalance) / input.initialQuoteBalance) * 100 : 0;
  const totalPnl = input.finalEquity - input.initialQuoteBalance;
  const periodMs = input.periodEndMs - input.periodStartMs;
  const periodsPerYear = GRANULARITY_PERIODS_PER_YEAR[input.granularity];

  const { maxDrawdownPct, maxDrawdownDurationDays } = computeDrawdown(input.equityCurve);
  const returns = periodReturns(input.equityCurve);

  const wins = input.trades.filter((t) => t.pnl > 0);
  const losses = input.trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losses.reduce((s, t) => s + Math.abs(t.pnl), 0);

  return {
    totalReturnPct,
    totalPnl,
    cagrPct: cagr(input.initialQuoteBalance, input.finalEquity, periodMs),
    maxDrawdownPct,
    maxDrawdownDurationDays,
    sharpeRatio: annualizedSharpe(returns, periodsPerYear),
    sortinoRatio: annualizedSortino(returns, periodsPerYear),
    winRatePct: input.trades.length > 0 ? (wins.length / input.trades.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    averageWin: wins.length > 0 ? grossProfit / wins.length : null,
    averageLoss: losses.length > 0 ? -grossLoss / losses.length : null,
    roundTripCount: input.trades.length,
    averageTradeDurationDays: input.trades.length > 0 ? mean(input.trades.map((t) => (t.closedAt - t.openedAt) / MS_PER_DAY)) : null,
    missedFillCount: input.missedFillCount,
  };
}
