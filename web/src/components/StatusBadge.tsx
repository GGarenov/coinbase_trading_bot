import type { SessionStatus } from "@/lib/api";

const STYLES: Record<SessionStatus, string> = {
  PENDING: "bg-surface-hover text-muted",
  RUNNING: "bg-green-900/40 text-green-400",
  PAUSED: "bg-amber-900/40 text-amber-400",
  STOPPED: "bg-surface-hover text-muted",
  COMPLETED: "bg-blue-900/40 text-blue-400",
  FAILED: "bg-red-900/40 text-red-400",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${STYLES[status]}`}>
      {status}
    </span>
  );
}
