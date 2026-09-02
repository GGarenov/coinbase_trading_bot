import { notFound } from "next/navigation";
import { EmptyState } from "@/components/EmptyState";
import { EquityChart } from "@/components/EquityChart";
import { StatTile } from "@/components/StatTile";
import { TradeLogTable } from "@/components/TradeLogTable";
import { ApiError, getBacktest } from "@/lib/api";
import { formatDateTime, formatNumber, formatPercent, formatUsd } from "@/lib/format";

// See page.tsx (home)'s doc comment for why this is required on every page that fetches live
// engine data — without it, `next build` tries to prerender this at build time.
export const dynamic = "force-dynamic";

export default async function BacktestReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const backtestId = Number(id);
  if (!Number.isInteger(backtestId)) notFound();

  let backtest;
  try {
    backtest = await getBacktest(backtestId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  const { report } = backtest;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-10">
      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Backtest #{backtest.sessionId} · {backtest.strategy.name} · {backtest.productId}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {formatDateTime(backtest.startDate)} – {formatDateTime(backtest.endDate)}
        </h1>
      </div>

      {backtest.status !== "COMPLETED" || !report ? (
        <EmptyState message={backtest.status === "FAILED" ? `Backtest failed: ${backtest.error ?? "unknown error"}` : `Backtest is ${backtest.status.toLowerCase()} — no report yet.`} />
      ) : (
        <>
          {report.curveFittingWarning && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-400">
              <p className="font-medium">Possible curve-fitting risk</p>
              <p className="mt-1">{report.curveFittingWarning}</p>
            </div>
          )}

          <section>
            <h2 className="text-lg font-medium">Performance</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <StatTile label="Total return" value={formatPercent(report.performance.totalReturnPct)} tone={report.performance.totalReturnPct >= 0 ? "positive" : "negative"} />
              <StatTile label="Total P&L" value={formatUsd(report.performance.totalPnl)} tone={report.performance.totalPnl >= 0 ? "positive" : "negative"} />
              <StatTile label="CAGR" value={formatPercent(report.performance.cagrPct)} tone={report.performance.cagrPct === null ? "neutral" : report.performance.cagrPct >= 0 ? "positive" : "negative"} />
              <StatTile label="Max drawdown" value={formatPercent(report.performance.maxDrawdownPct, 2, false)} tone={report.performance.maxDrawdownPct > 0 ? "negative" : "neutral"} />
              <StatTile label="Max drawdown duration" value={`${formatNumber(report.performance.maxDrawdownDurationDays, 1)} days`} />
              <StatTile label="Sharpe ratio" value={formatNumber(report.performance.sharpeRatio)} />
              <StatTile label="Sortino ratio" value={formatNumber(report.performance.sortinoRatio)} />
              <StatTile label="Win rate" value={formatPercent(report.performance.winRatePct, 2, false)} />
              <StatTile label="Profit factor" value={formatNumber(report.performance.profitFactor)} />
              <StatTile label="Average win" value={formatUsd(report.performance.averageWin)} tone="positive" />
              <StatTile label="Average loss" value={formatUsd(report.performance.averageLoss)} tone="negative" />
              <StatTile label="Round trips" value={formatNumber(report.performance.roundTripCount, 0)} />
              <StatTile label="Avg. trade duration" value={report.performance.averageTradeDurationDays === null ? "—" : `${formatNumber(report.performance.averageTradeDurationDays, 1)} days`} />
              <StatTile label="Missed fills" value={formatNumber(report.performance.missedFillCount, 0)} tone={report.performance.missedFillCount > 0 ? "negative" : "neutral"} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium">Equity curve</h2>
            <div className="mt-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
              <EquityChart data={report.equityCurve} />
            </div>
          </section>

          <section>
            <h2 className="text-lg font-medium">Trade log</h2>
            <div className="mt-3">{report.trades.length === 0 ? <EmptyState message="No completed round trips in this backtest." /> : <TradeLogTable trades={report.trades} />}</div>
          </section>
        </>
      )}
    </div>
  );
}
