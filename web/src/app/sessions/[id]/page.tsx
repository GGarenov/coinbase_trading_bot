import { notFound } from "next/navigation";
import { SessionDetailClient } from "@/components/SessionDetailClient";
import { ApiError, getSession } from "@/lib/api";

// See page.tsx (home)'s doc comment for why this is required on every page that fetches live
// engine data — without it, `next build` tries to prerender this at build time.
export const dynamic = "force-dynamic";

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId)) notFound();

  let session;
  try {
    session = await getSession(sessionId);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Session #{session.id} · {session.strategy.name} · {session.productId}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{session.strategy.name}</h1>
      </div>
      <SessionDetailClient id={sessionId} initial={session} />
    </div>
  );
}
