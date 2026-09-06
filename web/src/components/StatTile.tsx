import { Card } from "./Card";

/** A single stat-tile: label (sentence case) + value (semibold, proportional figures — not tabular, per the `dataviz` skill: tabular-nums is for table/axis columns, not a standalone value). */
export function StatTile({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "positive" | "negative" | "neutral" }) {
  const toneClass = tone === "positive" ? "text-green-400" : tone === "negative" ? "text-red-400" : "";
  return (
    <Card className="p-4">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </Card>
  );
}
