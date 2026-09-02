"use client";

import { CompareTable } from "@/components/CompareTable";
import { EmptyState } from "@/components/EmptyState";
import { EquityOverlayChart } from "@/components/EquityOverlayChart";
import type { SessionCompareRow } from "@/lib/api";
import { getSessionsCompare } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

/** Client Component — takes over from the Server Component's initial fetch and polls every ~3s (Phase 7.4, same cadence as Phase 6). */
export function CompareClient({ initial }: { initial: SessionCompareRow[] }) {
  const { data: rows } = usePolling<SessionCompareRow[]>(getSessionsCompare, initial);

  if (rows.length === 0) {
    return <EmptyState message="No paper or live sessions yet — start one from a strategy's config form to compare it here." />;
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-medium">Equity curves</h2>
        <div className="mt-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <EquityOverlayChart rows={rows} />
        </div>
      </section>
      <section>
        <h2 className="text-lg font-medium">Sessions</h2>
        <div className="mt-3">
          <CompareTable rows={rows} />
        </div>
      </section>
    </div>
  );
}
