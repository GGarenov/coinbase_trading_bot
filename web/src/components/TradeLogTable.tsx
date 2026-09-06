import type { BacktestTradeRecord } from "@/lib/api";
import { formatDateTime, formatUsd } from "@/lib/format";

export function TradeLogTable({ trades }: { trades: BacktestTradeRecord[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] text-left text-base">
        <thead className="border-b border-border text-sm uppercase tracking-wide text-muted">
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
        <tbody className="divide-y divide-border">
          {trades.map((trade, i) => (
            <tr key={i}>
              <td className="px-4 py-3 tabular-nums text-muted">{formatDateTime(trade.openedAt)}</td>
              <td className="px-4 py-3 tabular-nums text-muted">{formatDateTime(trade.closedAt)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatUsd(trade.costBasis)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatUsd(trade.proceeds)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted">{formatUsd(trade.feesTotal)}</td>
              <td className={`px-4 py-3 text-right tabular-nums font-medium ${trade.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>{formatUsd(trade.pnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
