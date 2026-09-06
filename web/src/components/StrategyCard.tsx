import Link from "next/link";
import type { StrategyCatalogEntry } from "@/lib/api";

export function StrategyCard({ strategy }: { strategy: StrategyCatalogEntry }) {
  return (
    <Link
      href={`/strategies/${strategy.slug}`}
      className="block rounded-xl border border-border bg-surface p-5 transition-colors hover:border-accent/50 hover:bg-surface-hover"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-medium">{strategy.name}</h3>
        <span className="shrink-0 rounded-full bg-surface-hover px-2.5 py-0.5 text-sm text-muted">{strategy.riskLevel}</span>
      </div>
      <p className="mt-2 text-base text-muted">{strategy.description}</p>
    </Link>
  );
}
