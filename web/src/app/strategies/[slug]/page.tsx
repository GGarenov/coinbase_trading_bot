import { notFound } from "next/navigation";
import { ConfigForm } from "@/components/ConfigForm";
import { ApiError, getStrategy } from "@/lib/api";

// See page.tsx (home)'s doc comment for why this is required on every page that fetches live
// engine data — without it, `next build` tries to prerender this at build time.
export const dynamic = "force-dynamic";

export default async function StrategyConfigPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let strategy;
  try {
    strategy = await getStrategy(slug);
  } catch (err) {
    // A genuinely unknown slug should render Next's not-found UI, not the generic
    // "could not reach the engine" error boundary — anything else (engine down, 500, etc.)
    // still bubbles up to error.tsx as normal.
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <span className="inline-block rounded-full bg-surface-hover px-2.5 py-0.5 text-sm text-muted">{strategy.riskLevel}</span>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{strategy.name}</h1>
      <p className="mt-1 text-base text-muted">{strategy.description}</p>
      <div className="mt-8">
        <ConfigForm strategy={strategy} />
      </div>
    </div>
  );
}
