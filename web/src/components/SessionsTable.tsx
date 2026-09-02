import Link from "next/link";
import type { SessionSummary } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

export function SessionsTable({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead className="border-b border-black/10 text-xs uppercase tracking-wide text-zinc-500 dark:border-white/10 dark:text-zinc-400">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Session
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Mode
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Product
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Started
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10 dark:divide-white/10">
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="px-4 py-3">
                <Link href={`/sessions/${session.id}`} className="font-medium hover:underline">
                  #{session.id} · {session.strategy.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className={session.mode === "LIVE" ? "font-semibold text-red-600 dark:text-red-400" : ""}>{session.mode}</span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={session.status} />
              </td>
              <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{session.productId}</td>
              <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400">{formatDateTime(session.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
