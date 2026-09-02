import Link from "next/link";
import type { StrategyCatalogEntry } from "@/lib/api";

export function StrategyCard({ strategy }: { strategy: StrategyCatalogEntry }) {
  return (
    <Link
      href={`/strategies/${strategy.slug}`}
      className="block rounded-lg border border-black/10 p-5 transition-colors hover:border-black/20 dark:border-white/10 dark:hover:border-white/20"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">{strategy.name}</h3>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {strategy.riskLevel}
        </span>
      </div>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{strategy.description}</p>
    </Link>
  );
}
