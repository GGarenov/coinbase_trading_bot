"use client"; // Error boundaries must be Client Components

import { Button } from "@/components/Button";

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
      <h1 className="text-2xl font-semibold">Could not load the dashboard</h1>
      <p className="mt-2 text-base text-muted">
        Make sure the engine is running (<code className="rounded bg-surface px-1.5 py-0.5">pnpm run dev:engine</code>) and reachable at the URL in{" "}
        <code className="rounded bg-surface px-1.5 py-0.5">NEXT_PUBLIC_ENGINE_URL</code>.
      </p>
      {error.digest && <p className="mt-2 text-sm text-muted">Error reference: {error.digest}</p>}
      <Button onClick={() => retry()} className="mt-6">
        Try again
      </Button>
    </div>
  );
}
