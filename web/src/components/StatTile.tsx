/** A single stat-tile: label (sentence case) + value (semibold, proportional figures — not tabular, per the `dataviz` skill: tabular-nums is for table/axis columns, not a standalone value). */
export function StatTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  const toneClass = tone === "positive" ? "text-green-600 dark:text-green-400" : tone === "negative" ? "text-red-600 dark:text-red-400" : "";
  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
