import { describe, expect, it } from "vitest";
import { gridStrategy, type GridParams } from "./grid";
import type { PortfolioState, PricePoint } from "../types";
import type { TradeDecision } from "./types";

// Written fresh against the current `grid.ts` — the earlier Binance-based
// iteration's grid was a simple auto-spaced limit grid (`lowerBound`/
// `upperBound`/`gridLevels`), structurally different from this project's
// explicit, non-uniform, stop-limit-with-buffer levels (declaration-order
// pairing, market-fallback opt-in, missed-fill reporting), so its old
// `grid.test.ts` doesn't port — these tests cover the actual current design
// instead, including the two behaviors Phase 1.4/1.5 specifically calls out:
// the stop-limit-with-buffer wait/timeout path and missed-fill logic.

const portfolio: PortfolioState = { quoteBalance: 10_000, baseBalance: 0 };

function feed(instance: ReturnType<typeof gridStrategy.create>, price: number, timestamp: number): TradeDecision[] {
  const point: PricePoint = { price, timestamp };
  return instance.onPrice(point, portfolio);
}

describe("Grid strategy", () => {
  it("does nothing on the first tick (needs a reference price)", () => {
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 140, side: "BUY" },
        { price: 160, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);
    expect(feed(grid, 150, 0)).toEqual([]);
  });

  it("fills immediately when price lands within the buffer of a crossed level, sells at its paired level", () => {
    // Levels: buy 140 (buffer ±0.7) pairs with sell 160 (buffer ±0.8); buy 120 pairs with sell 180 — unused here.
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 140, side: "BUY" },
        { price: 160, side: "SELL" },
        { price: 120, side: "BUY" },
        { price: 180, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150, 0); // reference
    const buys = feed(grid, 139.6, 1000); // crossed down through 140, landed 0.4 inside the 0.7 buffer
    expect(buys).toEqual([
      { kind: "ORDER", side: "BUY", orderType: "STOP_LIMIT", quoteAmount: 100, levelPrice: 140 },
    ]);

    const sells = feed(grid, 160.5, 2000); // crossed up through 160, landed 0.5 inside the 0.8 buffer
    expect(sells).toEqual([
      { kind: "ORDER", side: "SELL", orderType: "STOP_LIMIT", quantity: 100 / 139.6, costBasis: 100, levelPrice: 160, closingLevelPrice: 140 },
    ]);
  });

  it("waits when a crossing lands outside the buffer, then fills once price returns within it", () => {
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 140, side: "BUY" },
        { price: 160, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150, 0); // reference
    expect(feed(grid, 135, 1000)).toEqual([]); // crossed down through 140, but 5 away — outside the 0.7 buffer: waits
    const buys = feed(grid, 140.3, 1100); // price came back to 0.3 away — within the buffer: fills now
    expect(buys).toEqual([
      { kind: "ORDER", side: "BUY", orderType: "STOP_LIMIT", quoteAmount: 100, levelPrice: 140 },
    ]);
  });

  it("(Phase 1.5) reports a MISSED_FILL when a triggered entry times out with no market fallback configured", () => {
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 140, side: "BUY" },
        { price: 160, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150, 0); // reference
    expect(feed(grid, 135, 1000)).toEqual([]); // triggers, outside buffer, starts waiting
    const decisions = feed(grid, 133, 1000 + 300_000); // still outside buffer, exactly at the 300s timeout
    expect(decisions).toEqual([
      { kind: "MISSED_FILL", side: "BUY", levelPrice: 140, reason: expect.stringContaining("timed out") },
    ]);
  });

  it("(Phase 1.4) with market fallback enabled, a timed-out entry converts to a MARKET order instead of a missed fill", () => {
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 140, side: "BUY" },
        { price: 160, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: true, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150, 0);
    expect(feed(grid, 135, 1000)).toEqual([]);
    const decisions = feed(grid, 133, 1000 + 300_000);
    expect(decisions).toEqual([
      { kind: "ORDER", side: "BUY", orderType: "MARKET", quoteAmount: 100, levelPrice: 140 },
    ]);
  });

  it("(Phase 1.5) a missed exit does not lose the position — it keeps holding and can still sell later", () => {
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 140, side: "BUY" },
        { price: 160, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);

    feed(grid, 150, 0); // reference
    feed(grid, 139.6, 1000); // immediate buy fill at 140 — now holding
    expect(feed(grid, 170, 2000)).toEqual([]); // crossed up through 160 but 10 away — outside buffer: sell waits

    // The exit trigger times out with no fallback: reported as a missed fill, position preserved.
    const missed = feed(grid, 175, 2000 + 300_000);
    expect(missed).toEqual([{ kind: "MISSED_FILL", side: "SELL", levelPrice: 160, reason: expect.stringContaining("timed out") }]);

    expect(feed(grid, 150, 303_000)).toEqual([]); // dropping back below 160 does nothing — no re-trigger from a drop
    expect(feed(grid, 165, 304_000)).toEqual([]); // crosses up through 160 again, 5 away — outside buffer: waits again

    const sells = feed(grid, 160.3, 305_000); // 0.3 away — within buffer: the preserved position finally sells
    expect(sells).toEqual([
      { kind: "ORDER", side: "SELL", orderType: "STOP_LIMIT", quantity: 100 / 139.6, costBasis: 100, levelPrice: 160, closingLevelPrice: 140 },
    ]);
  });

  it("resumes from a state snapshot with a held position and its sell target intact", () => {
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 140, side: "BUY" },
        { price: 160, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);
    feed(grid, 150, 0);
    feed(grid, 139.6, 1000); // holding the 140 level
    const snapshot = grid.getState();

    const resumed = gridStrategy.create(params, 0);
    resumed.setState(snapshot);

    expect(feed(resumed, 139, 1)).toEqual([]); // still holding — must not re-buy
    const sells = feed(resumed, 160.5, 1000); // its 160 sell target still works after the restart
    expect(sells).toEqual([
      { kind: "ORDER", side: "SELL", orderType: "STOP_LIMIT", quantity: 100 / 139.6, costBasis: 100, levelPrice: 160, closingLevelPrice: 140 },
    ]);
  });

  it("pairs levels by declaration order, not by price adjacency (tightest pair declared first)", () => {
    // Doc-comment example: [{95,BUY},{90,BUY}] / [{105,SELL},{110,SELL}] pairs 95↔105 and 90↔110.
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 95, side: "BUY" },
        { price: 105, side: "SELL" },
        { price: 90, side: "BUY" },
        { price: 110, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);

    feed(grid, 100, 0); // reference
    const buy95 = feed(grid, 94.9, 1000); // crosses 95 (buffer ±0.475), 0.1 inside
    expect(buy95).toEqual([{ kind: "ORDER", side: "BUY", orderType: "STOP_LIMIT", quoteAmount: 100, levelPrice: 95 }]);

    const sell105 = feed(grid, 105.2, 2000); // crosses 105 (buffer ±0.525), 0.2 inside — closes the 95 slot, not the 90 slot
    expect(sell105).toEqual([
      { kind: "ORDER", side: "SELL", orderType: "STOP_LIMIT", quantity: 100 / 94.9, costBasis: 100, levelPrice: 105, closingLevelPrice: 95 },
    ]);

    const buy90 = feed(grid, 89.8, 3000); // crosses 90 (buffer ±0.45), 0.2 inside
    expect(buy90).toEqual([{ kind: "ORDER", side: "BUY", orderType: "STOP_LIMIT", quoteAmount: 100, levelPrice: 90 }]);

    const sell110 = feed(grid, 110.3, 4000); // crosses 110 (buffer ±0.55), 0.3 inside — closes the 90 slot, not 105 again
    expect(sell110).toEqual([
      { kind: "ORDER", side: "SELL", orderType: "STOP_LIMIT", quantity: 100 / 89.8, costBasis: 100, levelPrice: 110, closingLevelPrice: 90 },
    ]);
  });

  it("an extra BUY level beyond the SELL count accumulates with no configured exit, ever", () => {
    const params: GridParams = {
      productId: "SOL-USDC",
      levels: [
        { price: 100, side: "BUY" },
        { price: 90, side: "BUY" }, // no paired SELL — second BUY slot has none
        { price: 105, side: "SELL" },
      ],
      amountPerLevel: 100,
      stopLimitBufferPct: 0.5,
      marketFallback: { enabled: false, timeoutSeconds: 300 },
    };
    const grid = gridStrategy.create(params, 0);

    feed(grid, 110, 0); // reference
    expect(feed(grid, 99.5, 1000)).toEqual([ // crosses 100 (buffer ±0.5), 0.5 inside
      { kind: "ORDER", side: "BUY", orderType: "STOP_LIMIT", quoteAmount: 100, levelPrice: 100 },
    ]);
    expect(feed(grid, 89.6, 2000)).toEqual([ // crosses 90 (buffer ±0.45), 0.4 inside
      { kind: "ORDER", side: "BUY", orderType: "STOP_LIMIT", quoteAmount: 100, levelPrice: 90 },
    ]);

    // Price runs far above both slots' entry prices for a long time — the 100-level's paired
    // 105 sell eventually reports a missed fill (no fallback), but the 90-level (no sell paired
    // at all) must never produce a sell or a missed fill, no matter how high price goes.
    expect(feed(grid, 200, 3000)).toEqual([]); // 105 sell triggers (crossed, outside buffer) — waits
    const decisions = feed(grid, 205, 3000 + 300_000); // 105's exit trigger times out
    expect(decisions).toEqual([
      { kind: "MISSED_FILL", side: "SELL", levelPrice: 105, reason: expect.stringContaining("timed out") },
    ]);
    // No decision anywhere in this run ever referenced the 90-level slot's (nonexistent) exit.
  });
});
