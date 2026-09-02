import { CompareClient } from "@/components/CompareClient";
import { getSessionsCompare } from "@/lib/api";

// See page.tsx (home)'s doc comment for why this is required on every page that fetches live
// engine data — without it, `next build` tries to prerender this at build time.
export const dynamic = "force-dynamic";

/**
 * `compare/page.tsx` (Phase 7) — a table of every PAPER/LIVE session with
 * key metrics side by side, plus an equity-curve overlay chart, so several
 * parallel paper sessions (e.g. the same strategy with different grid
 * configs) can be judged against each other without opening a tab per
 * session. Deliberately no batch-launcher here — sessions are still
 * started one at a time from the Phase 4 config form; see the frontend
 * skill's own note on this being a scope decision, not an oversight.
 */
export default async function ComparePage() {
  const rows = await getSessionsCompare();

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Compare sessions</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">P&amp;L, win rate, fees, drawdown, and completed cycles across every paper and live session.</p>
      <div className="mt-8">
        <CompareClient initial={rows} />
      </div>
    </div>
  );
}
