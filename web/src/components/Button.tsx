import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-accent text-background hover:bg-accent-hover",
  secondary: "border border-border bg-surface text-foreground hover:bg-surface-hover",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

/**
 * The visual classes behind `Button`, exposed separately for the rare case
 * of a link that needs to *look* like a button (e.g. `not-found.tsx`'s
 * "Back to dashboard" — a navigation, so it must be an `<a>`/`next/link`,
 * not an actual `<button>`).
 */
export function buttonClassName(variant: Variant = "primary", className = ""): string {
  return `inline-flex min-h-[48px] items-center justify-center rounded-lg px-6 py-3 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASS[variant]} ${className}`;
}

/**
 * Shared button (styling redesign, see `docs/improving_design.md`) — every
 * button used to be a raw `<button>` with its own copy-pasted class string,
 * which is exactly why "make buttons bigger" required a multi-file
 * find-and-replace instead of a one-line change here.
 */
export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...props} className={buttonClassName(variant, className)} />;
}
