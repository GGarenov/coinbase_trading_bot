import type { MissedFillDto } from "@/lib/api";
import { formatDateTime, formatUsd } from "@/lib/format";

export function MissedFillsTable({ missedFills }: { missedFills: MissedFillDto[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[560px] text-left text-base">
        <thead className="border-b border-border text-sm uppercase tracking-wide text-muted">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Time
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Side
            </th>
            <th scope="col" className="px-4 py-3 text-right font-medium">
              Level price
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Reason
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {missedFills.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3 tabular-nums text-muted">{formatDateTime(m.occurredAt)}</td>
              <td className="px-4 py-3 font-medium">{m.side}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatUsd(m.levelPrice)}</td>
              <td className="px-4 py-3 text-muted">{m.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
