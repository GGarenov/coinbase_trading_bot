import type { BacktestTradeRecord } from "@/lib/api";
import { formatDateTime, formatUsd } from "@/lib/format";

export function TradeLogTable({ trades }: { trades: BacktestTradeRecord[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-black/10 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Opened
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Closed
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Cost basis
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Proceeds
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Fees
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              P&amp;L
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10 dark:divide-white/10">
          {trades.map((trade, i) => (
            <tr key={i}>
              <td className="px-4 py-3 tabular-nums text-zinc-500 dark:text-zinc-400">{formatDateTime(trade.openedAt)}</td>
              <td className="px-4 py-3 tabular-nums text-zinc-500 dark:text-zinc-400">{formatDateTime(trade.closedAt)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatUsd(trade.costBasis)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatUsd(trade.proceeds)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatUsd(trade.feesTotal)}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${trade.pnl >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{formatUsd(trade.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
