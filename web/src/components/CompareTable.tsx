"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SessionCompareRow } from "@/lib/api";
import { formatPercent, formatUsd } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

type SortKey = "sessionId" | "pnl" | "winRatePct" | "feesPaid" | "maxDrawdownPct" | "completedCycles";

const COLUMNS: Array<{ key: SortKey; label: string; align?: "right" }> = [
  { key: "sessionId", label: "Session" },
  { key: "pnl", label: "P&L", align: "right" },
  { key: "winRatePct", label: "Win rate", align: "right" },
  { key: "feesPaid", label: "Fees", align: "right" },
  { key: "maxDrawdownPct", label: "Max drawdown", align: "right" },
  { key: "completedCycles", label: "Cycles", align: "right" },
];

/** `null` (unranked, e.g. no completed cycles yet) always sorts last, regardless of direction — a missing value isn't "the lowest possible value" in either direction. */
function compareNullable(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * direction;
}

export function CompareTable({ rows }: { rows: SessionCompareRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({ key: "sessionId", direction: -1 });

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      switch (sort.key) {
        case "sessionId":
          return (a.sessionId - b.sessionId) * sort.direction;
        case "pnl":
          return (a.pnl - b.pnl) * sort.direction;
        case "winRatePct":
          return compareNullable(a.winRatePct, b.winRatePct, sort.direction);
        case "feesPaid":
          return (a.feesPaid - b.feesPaid) * sort.direction;
        case "maxDrawdownPct":
          return (a.maxDrawdownPct - b.maxDrawdownPct) * sort.direction;
        case "completedCycles":
          return (a.completedCycles - b.completedCycles) * sort.direction;
      }
    });
    return copy;
  }, [rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, direction: prev.direction === 1 ? -1 : 1 } : { key, direction: -1 }));
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="border-b border-black/10 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
          <tr>
            {COLUMNS.map((col) => (
              <th key={col.key} scope="col" className={`px-4 py-3 font-medium ${col.align === "right" ? "text-right" : ""}`}>
                <button type="button" onClick={() => toggleSort(col.key)} className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-50">
                  {col.label}
                  {sort.key === col.key && <span aria-hidden>{sort.direction === 1 ? "▲" : "▼"}</span>}
                </button>
              </th>
            ))}
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10 dark:divide-white/10">
          {sorted.map((row) => (
            <tr key={row.sessionId}>
              <td className="px-4 py-3">
                <Link href={`/sessions/${row.sessionId}`} className="font-medium hover:underline">
                  #{row.sessionId} · {row.strategy.name}
                </Link>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {row.mode} · {row.productId}
                </div>
              </td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${row.pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{formatUsd(row.pnl)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.winRatePct === null ? "—" : formatPercent(row.winRatePct, 1, false)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatUsd(row.feesPaid)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatPercent(row.maxDrawdownPct, 1, false)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.completedCycles}</td>
              <td className="px-4 py-3">
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
