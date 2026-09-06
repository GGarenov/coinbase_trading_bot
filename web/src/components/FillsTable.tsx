import type { OrderDto } from "@/lib/api";
import { formatDateTime, formatUsd } from "@/lib/format";

/** Flattens each order's (at most one, in this codebase — see `routes/sessions.ts`) fill into one row. */
export function FillsTable({ orders }: { orders: OrderDto[] }) {
  const rows = orders.flatMap((order) => order.fills.map((fill) => ({ order, fill })));

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] text-left text-base">
        <thead className="border-b border-border text-sm uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Time
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Side
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Liquidity
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Price
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Size
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Fee
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ order, fill }) => (
            <tr key={fill.id}>
              <td className="px-4 py-3 tabular-nums text-muted">{formatDateTime(fill.timestamp)}</td>
              <td className={`px-4 py-3 font-medium ${order.side === "BUY" ? "text-blue-400" : "text-orange-400"}`}>{order.side}</td>
              <td className="px-4 py-3 text-muted">{fill.liquidity}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatUsd(fill.price)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{fill.size}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted">{formatUsd(fill.fee)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
