"use client";

import { useMemo, useRef, useState } from "react";
import type { EquitySample } from "@/lib/api";
import { decimalsForStep, niceTicks } from "@/lib/chartScale";
import { formatDateShort, formatDateTime, formatUsd } from "@/lib/format";

const WIDTH = 960;
const HEIGHT = 320;
const PADDING = { top: 16, right: 16, bottom: 28, left: 64 };

/**
 * A single-series equity curve — see the `dataviz` skill's mark specs: 2px
 * line, ~10% opacity area wash, hairline recessive gridlines, an end-dot
 * with a surface ring, and a crosshair+tooltip hover layer (every value it
 * shows is also in the trade log / stats panel, never gated behind hover).
 * No legend — a single series' identity is already named by the section
 * heading above this chart.
 */
export function EquityChart({ data }: { data: EquitySample[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const plot = useMemo(() => {
    if (data.length === 0) return null;
    const xs = data.map((d) => d.timestamp);
    const ys = data.map((d) => d.equity);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yTicks = niceTicks(Math.min(...ys), Math.max(...ys), 5);
    const yMin = yTicks[0];
    const yMax = yTicks[yTicks.length - 1];
    const yTickDecimals = decimalsForStep(yTicks[1] - yTicks[0]);

    const innerW = WIDTH - PADDING.left - PADDING.right;
    const innerH = HEIGHT - PADDING.top - PADDING.bottom;
    const xScale = (t: number) => PADDING.left + (xMax === xMin ? innerW / 2 : ((t - xMin) / (xMax - xMin)) * innerW);
    const yScale = (v: number) => PADDING.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

    const points = data.map((d) => ({ x: xScale(d.timestamp), y: yScale(d.equity), sample: d }));
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const floorY = PADDING.top + innerH;
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${floorY} L${points[0].x.toFixed(2)},${floorY} Z`;

    // Index-based x-ticks (not time-based) — good enough for a roughly-evenly-sampled curve, and
    // avoids landing a tick on a moment with no nearby sample.
    const xTickCount = Math.min(6, data.length);
    const xTickIndices = Array.from({ length: xTickCount }, (_, i) => Math.round((i * (data.length - 1)) / Math.max(1, xTickCount - 1)));

    return { yTicks, yTickDecimals, innerH, points, linePath, areaPath, xTickIndices };
  }, [data]);

  if (!plot) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">No equity data.</p>;
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

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={`Equity curve from ${formatDateTime(data[0].timestamp)} to ${formatDateTime(data[data.length - 1].timestamp)}, ending at ${formatUsd(last.sample.equity)}`}
        tabIndex={0}
        onPointerMove={(e) => moveHoverToClientX(e.clientX)}
        onPointerLeave={() => setHoverIndex(null)}
        onKeyDown={handleKeyDown}
      >
        <g className="text-zinc-400 dark:text-zinc-600">
          {plot.yTicks.map((t) => {
            const y = PADDING.top + plot.innerH - ((t - plot.yTicks[0]) / (plot.yTicks[plot.yTicks.length - 1] - plot.yTicks[0] || 1)) * plot.innerH;
            return (
              <g key={t}>
                <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.25} strokeWidth={1} />
                <text x={PADDING.left - 8} y={y} textAnchor="end" dominantBaseline="middle" className="fill-zinc-500 dark:fill-zinc-400" fontSize={11}>
                  {formatUsd(t, plot.yTickDecimals)}
                </text>
              </g>
            );
          })}
          {plot.xTickIndices.map((i) => (
            <text key={i} x={plot.points[i].x} y={HEIGHT - PADDING.bottom + 18} textAnchor="middle" className="fill-zinc-500 dark:fill-zinc-400" fontSize={11}>
              {formatDateShort(plot.points[i].sample.timestamp)}
            </text>
          ))}
        </g>

        <g className="text-blue-600 dark:text-blue-400">
          <path d={plot.areaPath} fill="currentColor" fillOpacity={0.1} stroke="none" />
          <path d={plot.linePath} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={last.x} cy={last.y} r={4} fill="currentColor" stroke="var(--background)" strokeWidth={2} />
        </g>

        {hover && (
          <g>
            <line x1={hover.x} x2={hover.x} y1={PADDING.top} y2={PADDING.top + plot.innerH} className="text-zinc-400 dark:text-zinc-600" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} />
            <circle cx={hover.x} cy={hover.y} r={4} className="text-blue-600 dark:text-blue-400" fill="currentColor" stroke="var(--background)" strokeWidth={2} />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-md border border-black/10 bg-white px-2.5 py-1.5 text-xs shadow-sm dark:border-white/10 dark:bg-zinc-900"
          style={{ left: `${(hover.x / WIDTH) * 100}%`, transform: hover.x > WIDTH * 0.7 ? "translateX(-100%)" : "translateX(4px)" }}
        >
          <div className="font-medium tabular-nums">{formatUsd(hover.sample.equity)}</div>
          <div className="text-zinc-500 dark:text-zinc-400">{formatDateTime(hover.sample.timestamp)}</div>
        </div>
      )}
    </div>
  );
}
