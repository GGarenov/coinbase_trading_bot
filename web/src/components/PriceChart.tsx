"use client";

import { useMemo, useRef, useState } from "react";
import type { Candle } from "@/lib/api";
import { decimalsForStep, niceTicks } from "@/lib/chartScale";
import { formatDateShort, formatDateTime, formatUsd } from "@/lib/format";
import type { PriceLevel } from "@/lib/priceLevels";

const WIDTH = 960;
const HEIGHT = 320;
const PADDING = { top: 16, right: 16, bottom: 28, left: 64 };

/**
 * The `dataviz` skill's reference categorical palette, dark half, slots 1
 * and 2 — the same blue/orange `FillsTable.tsx` already uses for BUY/SELL,
 * kept identical here so a side means one color everywhere in the dashboard.
 * Deliberately NOT the profit-green/loss-red pair: a level is a configured
 * price, not an outcome, and green/red on it would read as "this level made
 * money".
 */
const SIDE_COLOR: Record<PriceLevel["side"], string> = { BUY: "#3987e5", SELL: "#d95926" };

/** Minimum vertical gap between two right-edge level labels before the later one is dropped as unreadable. */
const LABEL_MIN_GAP_PX = 14;

/**
 * Price context for a backtest — what the MARKET did over the run's window,
 * next to the equity curve's "what the strategy did with it". Same SVG
 * scaffold as `EquityChart.tsx` (shared `WIDTH`/`HEIGHT`/`PADDING`,
 * `chartScale.ts` ticks, crosshair hover, keyboard nav), with two
 * differences that matter:
 *
 * 1. It draws a high/low **band** under the close line, not a line alone.
 *    The fill logic only ever reads a candle's `close`, so a price can be
 *    touched intra-candle without the strategy ever seeing it — the band is
 *    where that gap becomes visible.
 * 2. The Y domain is stretched to include every reference level's price, even
 *    one far outside the period's actual range. That's the whole point of the
 *    chart: a grid configured at levels the market never reached should look
 *    obviously wrong, with the price band squashed into one corner and the
 *    levels stranded away from it.
 */
export function PriceChart({ candles, levels = [] }: { candles: Candle[]; levels?: PriceLevel[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plot = useMemo(() => {
    if (candles.length === 0) return null;
    const xs = candles.map((c) => c.openTime);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);

    const levelPrices = levels.map((l) => l.price);
    const yTicks = niceTicks(Math.min(...candles.map((c) => c.low), ...levelPrices), Math.max(...candles.map((c) => c.high), ...levelPrices), 5);
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];
    const yTickDecimals = decimalsForStep(yTicks[1] - yTicks[0]);

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const xScale = (t: number) => PADDING.left + (xMax === xMin ? innerW / 2 : ((t - xMin) / (xMax - xMin)) * innerW);
    const yScale = (v: number) => PADDING.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

    const points = candles.map((c) => ({ x: xScale(c.openTime), closeY: yScale(c.close), highY: yScale(c.high), lowY: yScale(c.low), candle: c }));
    const closePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.closeY.toFixed(2)}`).join(" ");
    // Out along the highs, back along the lows — one closed shape, so the band reads
    // as a single range rather than as two separate lines.
    const highLeg = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.highY.toFixed(2)}`).join(" ");
    const lowLeg = [...points]
      .reverse()
      .map((p) => `L${p.x.toFixed(2)},${p.lowY.toFixed(2)}`)
      .join(" ");
    const bandPath = `${highLeg} ${lowLeg} Z`;

    // Index-based x-ticks, matching EquityChart — hourly candles are evenly spaced,
    // so every tick lands on a real sample.
    const xTickCount = Math.min(6, candles.length);
    const xTickIndices = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (candles.length - 1)) / Math.max(1, xTickCount - 1)));

    // Highest price first, so the labels that survive collision-dropping are the
    // topmost ones rather than whichever happened to come first in the config.
    let lastLabelY = Number.NEGATIVE_INFINITY;
    const levelLines = [...levels]
      .sort((a, b) => b.price - a.price)
      .map((level) => {
        const y = yScale(level.price);
        const showLabel = y - lastLabelY >= LABEL_MIN_GAP_PX;
        if (showLabel) lastLabelY = y;
        return { ...level, y, showLabel };
      });

    return { yTicks, yMin, yMax, yTickDecimals, innerH, points, closePath, bandPath, xTickIndices, levelLines };
  }, [candles, levels]);

  if (!plot) {
    return <p className="text-base text-muted">No cached candles for this period.</p>;
  }

  function moveHoverToClientX(clientX: number) {
    const svg = svgRef.current;
    if (!svg || !plot) return;
    const rect = svg.getBoundingClientRect();
    const px = (clientX - rect.left) * (WIDTH / rect.width);
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < plot.points.length; i++) {
      const d = Math.abs(plot.points[i].x - px);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
    setHoverIndex(nearest);
  }

  function handleKeyDown(e: React.KeyboardEvent<SVGSVGElement>) {
    if (!plot) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setHoverIndex((i) => Math.max(0, (i ?? plot.points.length) - 1));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setHoverIndex((i) => Math.min(plot.points.length - 1, (i ?? -1) + 1));
    } else if (e.key === "Escape") {
      setHoverIndex(null);
    }
  }

  const hover = hoverIndex !== null ? plot.points[hoverIndex] : null;
  const last = plot.points[plot.points.length - 1];
  const priceDigits = Math.max(2, plot.yTickDecimals);
  const levelSides = (["BUY", "SELL"] as const).filter((side) => plot.levelLines.some((l) => l.side === side));

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Market price from ${formatDateTime(candles[0].openTime)} to ${formatDateTime(candles[candles.length - 1].openTime)}, closing at ${formatUsd(last.candle.close, priceDigits)}${
          plot.levelLines.length > 0 ? `, with ${plot.levelLines.length} configured level${plot.levelLines.length === 1 ? "" : "s"} overlaid` : ""
        }`}
        tabIndex={0}
        onPointerMove={(e) => moveHoverToClientX(e.clientX)}
        onPointerLeave={() => setHoverIndex(null)}
        onKeyDown={handleKeyDown}
      >
        <g className="text-muted">
          {plot.yTicks.map((t) => {
            const y = PADDING.top + plot.innerH - ((t - plot.yMin) / (plot.yMax - plot.yMin || 1)) * plot.innerH;
            return (
              <g key={t}>
                <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
                <text x={PADDING.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-muted" fontSize={12}>
                  {formatUsd(t, plot.yTickDecimals)}
                </text>
              </g>
            );
          })}
          {plot.xTickIndices.map((i) => (
            <text key={i} x={plot.points[i].x} y={HEIGHT - PADDING.bottom + 18} textAnchor="middle" className="fill-muted" fontSize={12}>
              {formatDateShort(plot.points[i].candle.openTime)}
            </text>
          ))}
        </g>

        <g className="text-accent">
          <path d={plot.bandPath} fill="currentColor" fillOpacity={0.16} stroke="none" />
          <path d={plot.closePath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last.x} cy={last.closeY} r={4} fill="currentColor" stroke="var(--background)" strokeWidth={2} />
        </g>

        {plot.levelLines.map((level) => (
          <g key={`${level.side}-${level.price}`}>
            <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={level.y} y2={level.y} stroke={SIDE_COLOR[level.side]} strokeWidth={1.5} strokeDasharray="6 4" />
            {level.showLabel && (
              // Direct label, so a level's side is never carried by color alone.
              <text x={WIDTH - PADDING.right} y={level.y - 5} textAnchor="end" fill={SIDE_COLOR[level.side]} fontSize={12} className="font-medium">
                {level.side} {formatUsd(level.price, priceDigits)}
              </text>
            )}
          </g>
        ))}

        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PADDING.top} y2={PADDING.top + plot.innerH} className="text-muted" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} />
            <circle cx={hover.x} cy={hover.closeY} r={4} className="text-accent" fill="currentColor" stroke="var(--background)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-sm"
          style={{ left: `${(hover.x / WIDTH) * 100}%`, transform: hover.x > WIDTH * 0.7 ? "translateX(-100%)" : "translateX(4px)" }}
        >
          <div className="font-medium tabular-nums">Close {formatUsd(hover.candle.close, priceDigits)}</div>
          <div className="tabular-nums text-muted">
            Low {formatUsd(hover.candle.low, priceDigits)} · High {formatUsd(hover.candle.high, priceDigits)}
          </div>
          <div className="text-muted">{formatDateTime(hover.candle.openTime)}</div>
        </div>
      )}

      {/* Legend — the band, the close line and the level lines are three distinct encodings, so identity is never left to color alone. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <span className="flex items-center gap-2">
          <span className="inline-block h-3 w-4 rounded-sm bg-accent/30" aria-hidden />
          High–low range
        </span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-4 bg-accent" aria-hidden />
          Close (the price the strategy acted on)
        </span>
        {levelSides.map((side) => (
          <span key={side} className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4" style={{ backgroundColor: SIDE_COLOR[side] }} aria-hidden />
            {side} levels
          </span>
        ))}
      </div>
    </div>
  );
}
