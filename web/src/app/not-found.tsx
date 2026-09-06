import Link from "next/link";
import { buttonClassName } from "@/components/Button";

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
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-base text-muted">This page doesn&apos;t exist — yet, or at all.</p>
      <Link href="/" className={`mt-6 ${buttonClassName()}`}>
        Back to dashboard
      </Link>
    </div>
  );
}
