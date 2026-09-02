function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-black/5 dark:bg-white/10 ${className}`} />;
}

/** Instant loading UI (Phase 3.4) — shown via React Suspense while `page.tsx`'s server-side fetch is in flight. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-12 px-6 py-10">
      <section>
        <SkeletonBlock className="h-7 w-56" />
        <SkeletonBlock className="mt-3 h-4 w-96 max-w-full" />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-28" />
          ))}
        </div>
      </section>
      <section>
        <SkeletonBlock className="h-7 w-40" />
        <SkeletonBlock className="mt-3 h-4 w-80 max-w-full" />
        <SkeletonBlock className="mt-6 h-40" />
      </section>
    </div>
  );
}
