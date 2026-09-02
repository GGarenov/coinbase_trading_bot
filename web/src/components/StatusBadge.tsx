import type { SessionStatus } from "@/lib/api";

const STYLES: Record<SessionStatus, string> = {
  PENDING: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  RUNNING: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400",
  PAUSED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  STOPPED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  COMPLETED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status]}`}>
      {status}
    </span>
  );
}
