import type { HTMLAttributes } from "react";

/**
 * Shared surface card (styling redesign, see `docs/improving_design.md`) —
 * cards used to be transparent boxes with only a border, which was a big
 * part of why the app read as "floating on black". Giving them a real
 * `bg-surface` fill fixes that directly.
 */
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-xl border border-border bg-surface p-6 ${className}`} />;
}
