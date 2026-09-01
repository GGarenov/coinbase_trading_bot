import type { Candle, Granularity } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { fetchCandles } from "../exchange/coinbase/rest";

const GRANULARITY_MS: Record<Granularity, number> = {
  ONE_HOUR: 60 * 60 * 1000,
  SIX_HOUR: 6 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
};

function fromCacheRow(row: { openTime: Date; open: unknown; high: unknown; low: unknown; close: unknown; volume: unknown }): Candle {
  return {
    openTime: row.openTime.getTime(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

/**
 * Reads candles for [startMs, endMs) from `PriceCandleCache`, hitting
 * Coinbase's REST API only when the cache doesn't already fully cover the
 * requested window — so re-running a backtest with different strategy
 * parameters over the same historical window (the normal "tune and re-run"
 * workflow) never re-fetches from Coinbase after the first run.
 *
 * Scope note (a deliberate first cut): coverage is checked by candle
 * COUNT, not by locating the exact missing sub-range — if even one candle
 * is missing anywhere in the window, the entire window is re-fetched and
 * upserted (Coinbase's own per-request pagination in `rest.ts` already
 * keeps this cheap: 350 candles per request). A finer per-gap backfill
 * would only save requests on a partially-cached window, which isn't the
 * common case here (a session always requests its own fixed date range).
 */
export async function getCachedCandles(productId: string, granularity: Granularity, startMs: number, endMs: number): Promise<Candle[]> {
  const stepMs = GRANULARITY_MS[granularity];
  const expectedCount = Math.ceil((endMs - startMs) / stepMs);

  const cached = await prisma.priceCandleCache.findMany({
    where: { productId, granularity, openTime: { gte: new Date(startMs), lt: new Date(endMs) } },
    orderBy: { openTime: "asc" },
  });

  if (expectedCount > 0 && cached.length >= expectedCount) {
    return cached.map(fromCacheRow);
  }

  const fresh = await fetchCandles(productId, granularity, startMs, endMs);
  await prisma.$transaction(
    fresh.map((candle) =>
      prisma.priceCandleCache.upsert({
        where: { productId_granularity_openTime: { productId, granularity, openTime: new Date(candle.openTime) } },
        create: {
          productId,
          granularity,
          openTime: new Date(candle.openTime),
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
        },
        update: { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume },
      }),
    ),
  );
  return fresh;
}
