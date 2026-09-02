/** Small, framework-agnostic formatting helpers shared across dashboard components. */

/** `null`/`undefined` render as an em dash, not "Invalid Date" or "null". Accepts an ISO string (most API dates) or a ms-epoch number (backtest report timestamps — see `api.ts`'s own note on why those differ). */
export function formatDateTime(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Short date only (no time) — for axis ticks and other dense contexts where a full timestamp is too wide. */
export function formatDateShort(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The engine's quote currency is USDC, not USD — there's no `Intl` currency
 * code for it, and USDC is tightly pegged 1:1 to USD (the same substitution
 * `stream.ts` documents on the engine side for price data), so `$`-formatting
 * via `Intl`'s USD currency is an accurate, pragmatic stand-in.
 */
export function formatUsd(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * `signed` (default true) prefixes a `+` for positive values — right for a
 * return-type delta (total return, CAGR), wrong for a magnitude that's
 * already non-negative by construction (win rate, max drawdown — a "+" on
 * "+1.22% drawdown" misreads as "drawdown improved"). Pass `signed: false`
 * for those.
 */
export function formatPercent(value: number | null | undefined, digits = 2, signed = true): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${signed && value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** Sentence-case a camelCase key into a human label — e.g. "maxDrawdownPct" -> "Max drawdown pct". Only used for truly generic fallbacks; prefer a hand-written label for anything user-facing. */
export function titleCase(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
