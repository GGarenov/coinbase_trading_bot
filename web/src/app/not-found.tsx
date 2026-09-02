import Link from "next/link";

/**
 * Rendered both for an explicit `notFound()` call (e.g. an unknown strategy
 * slug) and for any unmatched route — several pages built across Phases
 * 3–4 link forward to routes that don't exist yet until their own phase
 * (`sessions/[id]`, `backtests/[id]`, `compare`), so a friendly 404 here
 * beats Next's bare default while those are still being built out.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">This page doesn&apos;t exist — yet, or at all.</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
