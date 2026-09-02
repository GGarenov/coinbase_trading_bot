import { ApiError } from "./api";

/** Formats an `ApiError` from any engine route into a readable message, surfacing zod field errors (the `{error, details: {fieldErrors, formErrors}}` shape several routes return on a 400) when present rather than just the generic top-level message. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.details as { details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } } | undefined;
    const fieldErrors = body?.details?.fieldErrors;
    if (fieldErrors) {
      const parts = Object.entries(fieldErrors)
        .filter(([, messages]) => messages && messages.length > 0)
        .map(([field, messages]) => `${field}: ${messages.join(", ")}`);
      if (parts.length > 0) return `${err.message} (${parts.join("; ")})`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}
