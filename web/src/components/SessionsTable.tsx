import Link from "next/link";
import type { SessionSummary } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

export function SessionsTable({ sessions }: { sessions: SessionSummary[] }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[560px] text-left text-base">
        <thead className="border-b border-border text-sm uppercase tracking-wide text-muted">
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
        <tbody className="divide-y divide-border">
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="px-4 py-3">
                <Link href={`/sessions/${session.id}`} className="font-medium hover:underline">
                  #{session.id} · {session.strategy.name}
                </Link>
              </td>
              <td className="px-4 py-3">
                <span className={session.mode === "LIVE" ? "font-semibold text-red-400" : ""}>{session.mode}</span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={session.status} />
              </td>
              <td className="px-4 py-3 text-muted">{session.productId}</td>
              <td className="px-4 py-3 text-muted">{formatDateTime(session.startedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
