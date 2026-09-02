import { getSessions, getStrategies } from "@/lib/api";
import { EmptyState } from "@/components/EmptyState";
import { SessionsTable } from "@/components/SessionsTable";
import { StrategyCard } from "@/components/StrategyCard";

/**
 * Forces this route to render at REQUEST time, never at build time. Without
 * this, `next build` tries to statically prerender `/` (nothing here reads
 * a Request-time API like `cookies()`/`headers()`, so Next's default `dynamic:
 * "auto"` heuristic treats it as prerenderable) — which means a production
 * build would call `getStrategies()`/`getSessions()` against the engine
 * DURING THE BUILD ITSELF. Confirmed the hard way: a real `pnpm run build`
 * failed outright because the engine wasn't running at build time. Every
 * future page under `web/` that fetches live engine data needs this same
 * line, for the same reason — it's not specific to the home page.
 */
export const dynamic = "force-dynamic";

/**
 * `page.tsx` — strategy library cards + session list (Phase 3). A Server
 * Component: `getStrategies()`/`getSessions()` run server-side on every
 * request (this app doesn't enable Next 16's Cache Components, so a plain
 * `fetch()` like the one inside `src/lib/api.ts` is NOT cached by default —
 * every load/navigation gets a fresh read from the engine, which matters
 * here since session status changes whenever one is started/stopped).
 */
export default async function HomePage() {
  const [strategies, sessions] = await Promise.all([getStrategies(), getSessions()]);

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-10">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Strategy Library</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick a strategy to configure a backtest or start a paper/live session.
        </p>
        {strategies.length === 0 ? (
          <EmptyState message="No strategies found — run `pnpm run db:seed` in packages/shared." />
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {strategies.map((strategy) => (
              <StrategyCard key={strategy.slug} strategy={strategy} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-semibold tracking-tight">Sessions</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Paper and live sessions started from a strategy&apos;s config form.</p>
        {sessions.length === 0 ? (
          <EmptyState message="No sessions yet — start one from a strategy above." />
        ) : (
          <SessionsTable sessions={sessions} />
        )}
      </section>
    </div>
  );
}
