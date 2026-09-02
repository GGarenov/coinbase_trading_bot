"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls `fetcher` every `intervalMs` (default 3000 — the frontend skill's
 * proven ~3s cadence, matching the earlier Binance-based project). Starts
 * from `initial` so there's no loading flash on mount (the caller passes in
 * whatever a Server Component already fetched). On a transient fetch error,
 * keeps the last successful value rather than clearing the UI — `error`
 * surfaces alongside so a caller can show a small "stale" indicator without
 * losing the last-known-good render. Shared by Phase 6 (session detail) and
 * Phase 7 (compare view) — both poll on this same cadence.
 */
export function usePolling<T>(fetcher: () => Promise<T>, initial: T, intervalMs = 3000) {
  const [data, setData] = useState<T>(initial);
  const [error, setError] = useState<Error | null>(null);
  const fetcherRef = useRef(fetcher);
  // Refs may only be written in an effect/event handler, never during render (React's own
  // react-hooks/refs rule) — this keeps `refetch` referencing the LATEST `fetcher` closure on
  // every render without itself needing to change identity (so the interval effect below doesn't
  // need to restart just because the caller passed a new inline fetcher function).
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const refetch = useCallback(async () => {
    try {
      const next = await fetcherRef.current();
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refetch, intervalMs);
    return () => clearInterval(id);
  }, [refetch, intervalMs]);

  return { data, error, refetch };
}
