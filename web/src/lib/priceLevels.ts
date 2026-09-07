import type { OrderSide } from "./api";

/** One configured price level to overlay on the price chart as a horizontal reference line. */
export interface PriceLevel {
  price: number;
  side: OrderSide;
}

function isPriceLevel(value: unknown): value is PriceLevel {
  if (typeof value !== "object" || value === null) return false;
  const level = value as Record<string, unknown>;
  return typeof level.price === "number" && Number.isFinite(level.price) && (level.side === "BUY" || level.side === "SELL");
}

/**
 * Pulls overlayable price levels out of a strategy config's opaque `params`.
 *
 * Checked STRUCTURALLY — a `levels: {price, side}[]` array — rather than by
 * strategy slug. Only `grid` has that shape today (see
 * `packages/shared/src/strategies/grid.ts`), but a slug check would silently
 * stop working the day another strategy adopts the same field, and would need
 * editing here rather than just in the strategy. Any strategy whose params
 * don't match returns `[]`, and the chart then renders with no overlay lines.
 *
 * Non-conforming entries inside an otherwise-valid `levels` array are dropped
 * individually, so one malformed level can't blank out the rest.
 */
export function extractPriceLevels(params: unknown): PriceLevel[] {
  if (typeof params !== "object" || params === null) return [];
  const levels = (params as Record<string, unknown>).levels;
  if (!Array.isArray(levels)) return [];
  return levels.filter(isPriceLevel).map((level) => ({ price: level.price, side: level.side }));
}
