import type { MissedFillDto } from "@/lib/api";
import { formatDateTime, formatUsd } from "@/lib/format";

export function MissedFillsTable({ missedFills }: { missedFills: MissedFillDto[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-b border-black/10 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
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
        <tbody className="divide-y divide-black/10 dark:divide-white/10">
          {missedFills.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-3 tabular-nums text-zinc-500 dark:text-zinc-400">{formatDateTime(m.occurredAt)}</td>
              <td className="px-4 py-3 font-medium">{m.side}</td>
              <td className="px-4 py-3 text-right tabular-nums">{formatUsd(m.levelPrice)}</td>
              <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{m.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
