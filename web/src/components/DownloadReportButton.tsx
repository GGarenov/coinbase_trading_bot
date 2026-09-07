"use client";

import type { BacktestCandles, BacktestReport, BacktestSummary } from "@/lib/api";
import { Button } from "./Button";

/**
 * Turns whatever a date field holds into a filename-safe `YYYY-MM-DD`.
 * A raw ISO string can't go in a filename as-is — its colons are invalid on
 * Windows, which is where this project runs.
 */
function fileDate(value: string | null): string {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "unknown" : parsed.toISOString().slice(0, 10);
}

/** `SOL-USDC` is already safe, but a product id is engine data, not a constant — don't let it decide the filename's shape. */
function fileToken(value: string): string {
  return value.replace(/[^A-Za-z0-9-]+/g, "-");
}

/**
 * "Download report" — saves one self-contained JSON file describing a
 * completed backtest.
 *
 * The point of the file is that it can be handed to someone (or something)
 * with no access to this app and still be reviewable: alongside the metrics
 * and trade log it carries the strategy's actual configured params, the fee
 * schedule the run charged, the starting balances, and the price context the
 * run was fed. Without those, a reader can't tell what a grid was even set to
 * trade at.
 *
 * Everything is assembled from props — data the report page already fetched —
 * so a click costs no network request. That's also why this component
 * deliberately fetches nothing itself.
 */
export function DownloadReportButton({
  backtest,
  report,
  priceContext,
}: {
  backtest: BacktestSummary;
  report: BacktestReport;
  /**
   * `null` when the page's candle request failed or the cache had nothing for
   * the window (the page degrades to an empty state in that case). It is
   * exported as a literal `null` rather than an invented placeholder shape, so
   * a consumer has one thing to check instead of two.
   */
  priceContext: BacktestCandles | null;
}) {
  function handleDownload() {
    const payload = {
      session: {
        id: backtest.sessionId,
        productId: backtest.productId,
        startDate: backtest.startDate,
        endDate: backtest.endDate,
      },
      strategy: {
        slug: backtest.strategy.slug,
        name: backtest.strategy.name,
        params: backtest.strategyConfig.params,
      },
      feeSchedule: backtest.feeSchedule,
      initialQuoteBalance: backtest.initialQuoteBalance,
      initialBaseBalance: backtest.initialBaseBalance,
      performance: report.performance,
      equityCurve: report.equityCurve,
      trades: report.trades,
      missedFills: report.missedFills,
      curveFittingWarning: report.curveFittingWarning,
      priceContext: priceContext
        ? { granularity: priceContext.granularity, priceSummary: priceContext.priceSummary, candles: priceContext.candles }
        : null,
    };

    // Indented on purpose: this file exists to be read by a human or an AI
    // reviewer, and a single-line 720-candle blob is not readable.
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `backtest-${backtest.sessionId}-${fileToken(backtest.productId)}-${fileDate(backtest.startDate)}-${fileDate(backtest.endDate)}.json`;
    // Appended rather than just clicked detached — a detached anchor's click is
    // ignored by Firefox.
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next tick, not synchronously: the click only *starts* the
    // save, and revoking too early can cancel it.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Button variant="secondary" onClick={handleDownload}>
      Download report
    </Button>
  );
}
