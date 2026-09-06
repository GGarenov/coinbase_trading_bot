import type { Candle } from "@coinbase-trading-bot/shared";
import { describe, expect, it } from "vitest";
import { computePriceSummary } from "./priceSummary";

// Pure function, no DB and no Coinbase access — asserted directly against
// hand-built candle fixtures (unlike the Phase 6/7 service tests, which need
// real Prisma rows).

const HOUR_MS = 60 * 60 * 1000;

/** Builds a candle from just the fields this summary reads; open/volume are filler. */
function candle(index: number, low: number, high: number, close: number): Candle {
  return { openTime: index * HOUR_MS, open: close, high, low, close, volume: 1 };
}

describe("computePriceSummary()", () => {
  it("returns null for an empty candle list rather than zero-valued extremes", () => {
    expect(computePriceSummary([])).toBeNull();
  });

  it("reports every field from the single candle when the window has exactly one", () => {
    expect(computePriceSummary([candle(0, 95, 110, 100)])).toEqual({
      minClose: 100,
      maxClose: 100,
      avgClose: 100,
      minLow: 95,
      maxHigh: 110,
    });
  });

  it("collapses to one value per field when every candle is identical (flat market)", () => {
    const flat = [candle(0, 100, 100, 100), candle(1, 100, 100, 100), candle(2, 100, 100, 100)];
    expect(computePriceSummary(flat)).toEqual({ minClose: 100, maxClose: 100, avgClose: 100, minLow: 100, maxHigh: 100 });
  });

  it("takes min/max/avg across a known fixture", () => {
    const candles = [candle(0, 90, 105, 100), candle(1, 80, 130, 120), candle(2, 85, 125, 110)];
    expect(computePriceSummary(candles)).toEqual({
      minClose: 100,
      maxClose: 120,
      avgClose: 110,
      minLow: 80,
      maxHigh: 130,
    });
  });

  it("keeps the high/low extremes wider than the close extremes when prices are only touched intra-candle", () => {
    // The scenario the chart exists for: the market touched 130 and 80, but
    // no CLOSE ever left [100, 120] — so the close-only fill path never saw them.
    const summary = computePriceSummary([candle(0, 80, 130, 100), candle(1, 95, 115, 120)]);
    expect(summary).not.toBeNull();
    expect(summary!.minLow).toBeLessThan(summary!.minClose);
    expect(summary!.maxHigh).toBeGreaterThan(summary!.maxClose);
  });

  it("does not depend on candle ordering", () => {
    const candles = [candle(0, 90, 105, 100), candle(1, 80, 130, 120), candle(2, 85, 125, 110)];
    expect(computePriceSummary([...candles].reverse())).toEqual(computePriceSummary(candles));
  });

  it("averages closes as a true mean, not a midpoint of the extremes", () => {
    const summary = computePriceSummary([candle(0, 1, 1, 1), candle(1, 1, 1, 1), candle(2, 100, 100, 100)]);
    expect(summary!.avgClose).toBeCloseTo(34, 10);
  });
});
