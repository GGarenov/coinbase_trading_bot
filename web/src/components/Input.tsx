/**
 * Shared form field classes (styling redesign, see `docs/improving_design.md`)
 * — previously duplicated verbatim in both `ConfigForm.tsx` and
 * `SchemaField.tsx`. Kept as plain class-name strings rather than a wrapping
 * component since call sites use them across several native element types
 * (text/number/date inputs, `<select>`, checkboxes) with their own layout.
 */
export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-base text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

export const labelClass = "block text-base font-medium text-foreground";
