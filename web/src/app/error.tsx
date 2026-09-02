"use client"; // Error boundaries must be Client Components

/**
 * Route-level error boundary (Phase 3.4) — catches anything `page.tsx`
 * throws, most likely `src/lib/api.ts`'s `ApiError` when the engine is
 * unreachable or returns a non-2xx response. `error.message` is a generic,
 * identifier-only string in production for errors thrown from a Server
 * Component (Next.js strips the real message to avoid leaking server
 * details) — so this leans on a static, always-useful hint rather than
 * trying to parse the message.
 */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-5xl px-6 py-16 text-center">
      <h1 className="text-xl font-semibold">Could not load the dashboard</h1>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Make sure the engine is running (<code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">pnpm run dev:engine</code>) and
        reachable at the URL in <code className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/10">NEXT_PUBLIC_ENGINE_URL</code>.
      </p>
      {error.digest && <p className="mt-2 text-xs text-zinc-400 dark:text-zinc-500">Error reference: {error.digest}</p>}
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
      >
        Try again
      </button>
    </div>
  );
}
