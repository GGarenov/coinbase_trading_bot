"use client";

import { useMemo, useRef, useState } from "react";
import type { SessionCompareRow } from "@/lib/api";
import { decimalsForStep, niceTicks } from "@/lib/chartScale";
import { formatDateShort, formatDateTime, formatUsd } from "@/lib/format";

const WIDTH = 960;
const HEIGHT = 360;
const PADDING = { top: 16, right: 16, bottom: 28, left: 64 };

/**
 * The `dataviz` skill's reference categorical palette (`references/palette.md`),
 * used verbatim — this is the DEFAULT, already-validated order (CVD-safe
 * adjacent pairs in both light and dark), not a custom brand substitution,
 * so no re-run of the validator script is needed here (that's only required
 * when swapping in different hues). Capped at 8 slots per the skill's own
 * "a 9th series is never a generated hue" rule — an overlay with more
 * sessions than that folds the rest into "Other" below.
 */
const CATEGORICAL_PALETTE: Array<{ light: string; dark: string }> = [
  { light: "#2a78d6", dark: "#3987e5" }, // blue
  { light: "#eb6834", dark: "#d95926" }, // orange
  { light: "#1baf7a", dark: "#199e70" }, // aqua
  { light: "#eda100", dark: "#c98500" }, // yellow
  { light: "#e87ba4", dark: "#d55181" }, // magenta
  { light: "#008300", dark: "#008300" }, // green
  { light: "#4a3aa7", dark: "#9085e9" }, // violet
  { light: "#e34948", dark: "#e66767" }, // red
];

/** Nearest sample in a (timestamp-sorted) series to a target time — each series has its own, independent tick times, so "nearest" is genuinely per-series, not a shared index. */
function nearestSample<T extends { timestamp: number }>(series: T[], targetT: number): T | null {
  if (series.length === 0) return null;
  let nearest = series[0];
  let best = Math.abs(series[0].timestamp - targetT);
  for (const s of series) {
    const d = Math.abs(s.timestamp - targetT);
    if (d < best) {
      best = d;
      nearest = s;
    }
  }
  return nearest;
}

/**
 * Multi-session equity-curve overlay (Phase 7.3) — one line per session,
 * sharing a single Y axis (never dual-axis, per the `dataviz` skill's #1
 * rule) since every session's equity is already the same unit (quote
 * currency). Unlike Phase 5's single-series chart, this one DOES need a
 * legend (2+ series) and per-series categorical color, both from the
 * skill's default palette.
 */
export function EquityOverlayChart({ rows }: { rows: SessionCompareRow[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverT, setHoverT] = useState<number | null>(null);

  const series = useMemo(
    () =>
      rows
        .filter((r) => r.equityCurve.length > 0)
        .slice(0, CATEGORICAL_PALETTE.length)
        .map((r, i) => ({ row: r, colorIndex: i, points: [...r.equityCurve].sort((a, b) => a.timestamp - b.timestamp) })),
    [rows],
  );
  const overflow = Math.max(0, rows.filter((r) => r.equityCurve.length > 0).length - CATEGORICAL_PALETTE.length);

  const plot = useMemo(() => {
    if (series.length === 0) return null;
    const allPoints = series.flatMap((s) => s.points);
    const xMin = Math.min(...allPoints.map((p) => p.timestamp));
    const xMax = Math.max(...allPoints.map((p) => p.timestamp));
    const yTicks = niceTicks(
      Math.min(...allPoints.map((p) => p.equity)),
      Math.max(...allPoints.map((p) => p.equity)),
      5,
    );
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const xScale = (t: number) => PADDING.left + (xMax === xMin ? innerW / 2 : ((t - xMin) / (xMax - xMin)) * innerW);
    const yScale = (v: number) => PADDING.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

    const lines = series.map((s) => ({
      ...s,
      linePath: s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xScale(p.timestamp).toFixed(2)},${yScale(p.equity).toFixed(2)}`).join(" "),
      last: s.points[s.points.length - 1],
    }));

    const xTickCount = 6;
    const xTicks = Array.from({ length: xTickCount }, (_, i) => xMin + (i * (xMax - xMin)) / (xTickCount - 1));
    const yTickDecimals = decimalsForStep(yTicks[1] - yTicks[0]);

    return { xScale, yScale, yTicks, yTickDecimals, innerH, lines, xTicks, xMin, xMax };
  }, [series]);

  if (!plot) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No equity data to compare yet.</p>;
  }

  function moveHoverToClientX(clientX: number) {
    const svg = svgRef.current;
    if (!svg || !plot) return;
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) * (WIDTH / rect.width);
    const t = plot.xMin + ((px - PADDING.left) / (WIDTH - PADDING.left - PADDING.right)) * (plot.xMax - plot.xMin);
    setHoverT(Math.min(plot.xMax, Math.max(plot.xMin, t)));
  }

  const hoverRows = hoverT === null ? null : plot.lines.map((l) => ({ ...l, sample: nearestSample(l.points, hoverT) }));
  const hoverX = hoverT === null ? null : plot.xScale(hoverT);

  return (
    <div>
      <style>{`
        .equity-overlay { color-scheme: light; }
        ${CATEGORICAL_PALETTE.map((c, i) => `.equity-overlay { --eo-series-${i}: ${c.light}; }`).join("\n")}
        @media (prefers-color-scheme: dark) {
          .equity-overlay { color-scheme: dark; }
          ${CATEGORICAL_PALETTE.map((c, i) => `.equity-overlay { --eo-series-${i}: ${c.dark}; }`).join("\n")}
        }
      `}</style>
      <div className="equity-overlay relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full"
          role="img"
          aria-label={`Equity curve overlay for ${series.length} session${series.length === 1 ? "" : "s"}`}
          tabIndex={0}
          onPointerMove={(e) => moveHoverToClientX(e.clientX)}
          onPointerLeave={() => setHoverT(null)}
        >
          <g className="text-zinc-400 dark:text-zinc-600">
            {plot.yTicks.map((t) => {
              const y = plot.yScale(t);
              return (
                <g key={t}>
                  <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
                  <text x={PADDING.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-zinc-500 dark:fill-zinc-400" fontSize={11}>
                    {formatUsd(t, plot.yTickDecimals)}
                  </text>
                </g>
              );
            })}
            {plot.xTicks.map((t, i) => (
              <text key={i} x={plot.xScale(t)} y={HEIGHT - PADDING.bottom + 18} textAnchor="middle" className="fill-zinc-500 dark:fill-zinc-400" fontSize={11}>
                {formatDateShort(t)}
              </text>
            ))}
          </g>

          {plot.lines.map((l) => (
            <g key={l.row.sessionId} style={{ color: `var(--eo-series-${l.colorIndex})` }}>
              <path d={l.linePath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={plot.xScale(l.last.timestamp)} cy={plot.yScale(l.last.equity)} r={4} fill="currentColor" stroke="var(--background)" strokeWidth={2} />
            </g>
          ))}

          {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={PADDING.top} y2={PADDING.top + plot.innerH} className="text-zinc-400 dark:text-zinc-600" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} />}
        </svg>

        {hoverRows && (
          <div
            className="pointer-events-none absolute top-2 z-10 max-w-60 rounded-md border border-black/10 bg-white p-2.5 text-xs shadow-sm dark:border-white/10 dark:bg-zinc-900"
            style={{ left: `${((hoverX ?? 0) / WIDTH) * 100}%`, transform: (hoverX ?? 0) > WIDTH * 0.6 ? "translateX(-100%)" : "translateX(4px)" }}
          >
            {hoverRows.map(
              (l) =>
                l.sample && (
                  <div key={l.row.sessionId} className="flex items-center gap-1.5 py-0.5">
                    <span className="h-0.5 w-3 shrink-0" style={{ backgroundColor: `var(--eo-series-${l.colorIndex})` }} />
                    <span className="truncate text-zinc-500 dark:text-zinc-400">#{l.row.sessionId}</span>
                    <span className="ml-auto font-medium tabular-nums">{formatUsd(l.sample.equity)}</span>
                  </div>
                ),
            )}
            <div className="mt-1 border-t border-black/10 pt-1 text-zinc-400 dark:border-white/10 dark:text-zinc-500">{formatDateTime(hoverT)}</div>
          </div>
        )}
      </div>

      {series.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {plot.lines.map((l) => (
            <div key={l.row.sessionId} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 shrink-0" style={{ backgroundColor: `var(--eo-series-${l.colorIndex})` }} />
              <span className="text-zinc-600 dark:text-zinc-400">
                #{l.row.sessionId} {l.row.strategy.name}
              </span>
            </div>
          ))}
        </div>
      )}
      {overflow > 0 && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">+{overflow} more session(s) not shown (chart is capped at {CATEGORICAL_PALETTE.length} series — see the table above for all of them).</p>}
    </div>
  );
}
