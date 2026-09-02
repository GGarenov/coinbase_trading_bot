import type { TradeDecision } from "@coinbase-trading-bot/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeOrder, OrderRejectedError } from "./orderExecutor";
import type { PlaceOrderResult } from "./tradingClient";
import type { ProductInfo } from "./rest";

// (Proposed, tasks-qa.md Phase 5) — `executeOrder` is the one function in
// this codebase that can place a real order, so its two safety checks
// (rounding down to the exchange's declared increments, and rejecting an
// order that's still too small after rounding) need direct coverage rather
// than trusting the code by inspection. Everything around those checks
// (the kill switch, CDP credentials, the actual HTTP call) is mocked away —
// this suite is only exercising the pure size-rounding/min-notional math.
// vi.mock calls are hoisted above every import (including the static import
// of the module under test above) by vitest itself, so this works without a
// dynamic/top-level-await import — which also keeps this file compatible
// with this package's CommonJS-targeted `tsc --noEmit`.

const placeOrder = vi.fn<() => Promise<PlaceOrderResult>>();

vi.mock("../../services/killSwitch", () => ({
  isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
}));
vi.mock("./tradingClient", () => ({
  getTradingClient: () => ({ placeOrder }),
}));

const productInfo: ProductInfo = {
  productId: "SOL-USDC",
  baseIncrement: 0.01,
  quoteIncrement: 0.01,
  baseMinSize: 0.01,
  baseMaxSize: 1000,
  quoteMinSize: 1,
  quoteMaxSize: 1_000_000,
};

beforeEach(() => {
  process.env.LIVE_TRADING_ENABLED = "true";
  placeOrder.mockReset();
  placeOrder.mockResolvedValue({ orderId: "order-1", success: true });
});

describe("executeOrder — size-rounding logic (Phase 5.3)", () => {
  it("rounds a limit BUY's base size down to base_increment (never up, to never overspend the intended amount)", async () => {
    // 100 / 140 = 0.7142857142857143 → floored to the nearest 0.01 → 0.71.
    const decision: Extract<TradeDecision, { kind: "ORDER" }> = {
      kind: "ORDER",
      side: "BUY",
      orderType: "STOP_LIMIT",
      quoteAmount: 100,
      levelPrice: 140,
    };
    const fill = await executeOrder(decision, 140, productInfo, { makerRate: 0.006, takerRate: 0.012 });

    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ baseSize: "0.71", limitPrice: "140" }));
    expect(fill.size).toBe(0.71);
  });

  it("rounds a SELL's base size down to base_increment", async () => {
    const decision: Extract<TradeDecision, { kind: "ORDER" }> = {
      kind: "ORDER",
      side: "SELL",
      orderType: "STOP_LIMIT",
      quantity: 0.7168, // → floored to 0.71
      costBasis: 100,
      levelPrice: 160,
    };
    const fill = await executeOrder(decision, 160, productInfo, { makerRate: 0.006, takerRate: 0.012 });

    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ baseSize: "0.71" }));
    expect(fill.size).toBe(0.71);
  });

  it("rounds a market BUY's quote spend down to quote_increment (sized in quote currency, not base)", async () => {
    const decision: Extract<TradeDecision, { kind: "ORDER" }> = {
      kind: "ORDER",
      side: "BUY",
      orderType: "MARKET",
      quoteAmount: 75.567, // → floored to 75.56
    };
    await executeOrder(decision, 100, productInfo, { makerRate: 0.006, takerRate: 0.012 });

    expect(placeOrder).toHaveBeenCalledWith(expect.objectContaining({ quoteSize: "75.56", baseSize: undefined }));
  });
});

describe("executeOrder — min-notional-check logic (Phase 5.4)", () => {
  it("rejects an order whose rounded base size falls below the product's baseMinSize, without ever placing it", async () => {
    const decision: Extract<TradeDecision, { kind: "ORDER" }> = {
      kind: "ORDER",
      side: "BUY",
      orderType: "STOP_LIMIT",
      quoteAmount: 1, // 1 / 140 ≈ 0.00714 — rounds down to 0.00, below baseMinSize 0.01
      levelPrice: 140,
    };
    await expect(executeOrder(decision, 140, productInfo, { makerRate: 0.006, takerRate: 0.012 })).rejects.toThrow(
      /baseMinSize/,
    );
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("rejects an order whose rounded notional falls below the product's quoteMinSize, even though baseMinSize passes", async () => {
    // Real gap found and fixed while writing this test: this check didn't exist in
    // orderExecutor.ts at all — `ProductInfo.quoteMinSize` was fetched but never read.
    // A cheap, low-priced product can clear baseMinSize while its order VALUE is still
    // below the exchange's minimum, so both checks are needed, independently.
    const cheapProduct: ProductInfo = { ...productInfo, baseMinSize: 0.001, quoteMinSize: 5 };
    const decision: Extract<TradeDecision, { kind: "ORDER" }> = {
      kind: "ORDER",
      side: "BUY",
      orderType: "STOP_LIMIT",
      quoteAmount: 2, // 2 / 140 ≈ 0.0142 base (clears baseMinSize 0.001), notional ≈ 2 < quoteMinSize 5
      levelPrice: 140,
    };
    await expect(executeOrder(decision, 140, cheapProduct, { makerRate: 0.006, takerRate: 0.012 })).rejects.toThrow(
      /quoteMinSize/,
    );
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("accepts an order that clears both floors", async () => {
    const decision: Extract<TradeDecision, { kind: "ORDER" }> = {
      kind: "ORDER",
      side: "BUY",
      orderType: "STOP_LIMIT",
      quoteAmount: 100,
      levelPrice: 140,
    };
    await expect(
      executeOrder(decision, 140, productInfo, { makerRate: 0.006, takerRate: 0.012 }),
    ).resolves.toBeDefined();
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });

  it("surfaces a Coinbase rejection as OrderRejectedError, distinct from a local size-check failure", async () => {
    placeOrder.mockResolvedValueOnce({ orderId: "", success: false, failureReason: "INSUFFICIENT_FUND" });
    const decision: Extract<TradeDecision, { kind: "ORDER" }> = {
      kind: "ORDER",
      side: "BUY",
      orderType: "STOP_LIMIT",
      quoteAmount: 100,
      levelPrice: 140,
    };
    await expect(executeOrder(decision, 140, productInfo, { makerRate: 0.006, takerRate: 0.012 })).rejects.toThrow(
      OrderRejectedError,
    );
  });
});
