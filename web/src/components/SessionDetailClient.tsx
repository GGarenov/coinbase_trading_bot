"use client";

import { useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { FillsTable } from "@/components/FillsTable";
import { MissedFillsTable } from "@/components/MissedFillsTable";
import { StatTile } from "@/components/StatTile";
import { StatusBadge } from "@/components/StatusBadge";
import type { KillSwitchState, SessionDetail } from "@/lib/api";
import { getKillSwitch, getSession, pauseSession, startSession, stopSession } from "@/lib/api";
import { describeError } from "@/lib/describeError";
import { formatDateTime, formatUsd } from "@/lib/format";
import { usePolling } from "@/lib/usePolling";

const cardClass = "rounded-lg border border-black/10 p-5 dark:border-white/10";

type PolledState = { session: SessionDetail; killSwitch: KillSwitchState | null };
type ActionState = { kind: "idle" } | { kind: "busy"; action: string } | { kind: "error"; message: string };

/**
 * Client Component — takes over from the Server Component's initial fetch
 * and polls every ~3s (Phase 6.1's cadence), matching the frontend skill's
 * proven interval from the earlier Binance-based project. Combines the
 * session fetch and (for LIVE sessions only) the kill-switch fetch into one
 * poll tick via `usePolling`, rather than running two independent timers.
 */
export function SessionDetailClient({ id, initial }: { id: number; initial: SessionDetail }) {
  const { data, refetch } = usePolling<PolledState>(
    async () => {
      const session = await getSession(id);
      const killSwitch = session.mode === "LIVE" ? await getKillSwitch() : null;
      return { session, killSwitch };
    },
    { session: initial, killSwitch: null },
  );
  const { session, killSwitch } = data;
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });

  async function runControl(action: "start" | "pause" | "stop") {
    setActionState({ kind: "busy", action });
    try {
      if (action === "start") await startSession(id);
      else if (action === "pause") await pauseSession(id);
      else await stopSession(id);
      await refetch();
      setActionState({ kind: "idle" });
    } catch (err) {
      setActionState({ kind: "error", message: describeError(err) });
    }
  }

  const busy = actionState.kind === "busy";
  const isTerminal = session.status === "STOPPED" || session.status === "COMPLETED";
  const fills = session.recentOrders.flatMap((o) => o.fills);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={session.status} />
        <span className={session.mode === "LIVE" ? "font-semibold text-red-600 dark:text-red-400" : "text-zinc-500 dark:text-zinc-400"}>{session.mode}</span>
        {session.error && <span className="text-sm text-red-600 dark:text-red-400">{session.error}</span>}
      </div>

      <section>
        <h2 className="text-lg font-medium">Overview</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <StatTile label="Current price" value={session.currentPrice === null ? "—" : formatUsd(session.currentPrice)} />
          <StatTile label="Equity" value={formatUsd(session.equity)} />
          <StatTile label="Unrealized P&L" value={session.unrealizedPnl === null ? "—" : formatUsd(session.unrealizedPnl)} tone={session.unrealizedPnl === null ? "neutral" : session.unrealizedPnl >= 0 ? "positive" : "negative"} />
          <StatTile label="Realized P&L" value={formatUsd(session.realizedPnl)} tone={session.realizedPnl >= 0 ? "positive" : "negative"} />
          <StatTile label="Quote balance" value={formatUsd(session.quoteBalance)} />
          <StatTile label="Base balance" value={String(session.baseBalance)} />
          <StatTile label="Fees paid" value={formatUsd(session.feesPaid)} />
          <StatTile label="Started" value={formatDateTime(session.startedAt)} />
        </div>
      </section>

      <section className={cardClass}>
        <h2 className="font-medium">Controls</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {session.status === "RUNNING" && (
            <>
              <ControlButton label="Pause" busyLabel="Pausing…" pending={actionState.kind === "busy" && actionState.action === "pause"} disabled={busy} onClick={() => runControl("pause")} />
              <ControlButton label="Stop" busyLabel="Stopping…" pending={actionState.kind === "busy" && actionState.action === "stop"} disabled={busy} onClick={() => runControl("stop")} variant="danger" />
            </>
          )}
          {(session.status === "PAUSED" || session.status === "FAILED" || session.status === "PENDING") && (
            <>
              <ControlButton label="Start" busyLabel="Starting…" pending={actionState.kind === "busy" && actionState.action === "start"} disabled={busy} onClick={() => runControl("start")} />
              <ControlButton label="Stop" busyLabel="Stopping…" pending={actionState.kind === "busy" && actionState.action === "stop"} disabled={busy} onClick={() => runControl("stop")} variant="danger" />
            </>
          )}
          {isTerminal && <p className="text-sm text-zinc-500 dark:text-zinc-400">This session is {session.status.toLowerCase()} — not resumable.</p>}
        </div>
        {actionState.kind === "error" && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{actionState.message}</p>}
      </section>

      {session.mode === "LIVE" && (
        <section className={`${cardClass} border-red-200 dark:border-red-900/50`}>
          <h2 className="font-medium text-red-700 dark:text-red-400">Live-trading safety status</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Kill switch" value={killSwitch === null ? "—" : killSwitch.engaged ? "ENGAGED" : "Off"} tone={killSwitch?.engaged ? "negative" : "positive"} />
            <StatTile label="Max spend / order" value={session.maxSpendPerOrder === null ? "No cap set" : formatUsd(session.maxSpendPerOrder)} tone={session.maxSpendPerOrder === null ? "negative" : "neutral"} />
            <StatTile label="Max position size" value={session.maxPositionSize === null ? "No cap set" : String(session.maxPositionSize)} tone={session.maxPositionSize === null ? "negative" : "neutral"} />
          </div>
        </section>
      )}

      <section>
        <h2 className="text-lg font-medium">Strategy state</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Raw internal snapshot for {session.strategy.name}. No order in this project ever sits &quot;open&quot; waiting to fill — every order resolves the same tick it&apos;s created — so this is the real
          substitute for an open-orders view.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-black/10 bg-black/2 p-4 text-xs dark:border-white/10 dark:bg-white/3">{JSON.stringify(session.strategyState, null, 2)}</pre>
      </section>

      <section>
        <h2 className="text-lg font-medium">Fills</h2>
        <div className="mt-3">{fills.length === 0 ? <EmptyState message="No fills yet." /> : <FillsTable orders={session.recentOrders} />}</div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Missed fills</h2>
        <div className="mt-3">{session.missedFills.length === 0 ? <EmptyState message="No missed fills." /> : <MissedFillsTable missedFills={session.missedFills} />}</div>
      </section>
    </div>
  );
}

function ControlButton({
  label,
  busyLabel,
  pending,
  disabled,
  onClick,
  variant = "default",
}: {
  label: string;
  busyLabel: string;
  /** Whether THIS button's own action is the one in flight — distinct from `disabled`, which also covers "some OTHER control action is running". */
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  variant?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
        variant === "danger"
          ? "bg-red-600 text-white hover:bg-red-500"
          : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      }`}
    >
      {pending ? busyLabel : label}
    </button>
  );
}
