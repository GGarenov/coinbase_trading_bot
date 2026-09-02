import { describe, expect, it } from "vitest";
import { classifyLiquidity, DEFAULT_FEE_SCHEDULE, resolveFeeRate } from "./fees";

// (Proposed, tasks-qa.md Phase 5) — not derived from an old-project test file
// (fee classification is new to this project; the earlier Binance iteration
// didn't model maker/taker at all), written fresh against the current
// `classifyLiquidity`/`resolveFeeRate` contract.

describe("classifyLiquidity", () => {
  it("classifies LIMIT and STOP_LIMIT as MAKER — a resting order that got hit", () => {
    expect(classifyLiquidity("LIMIT")).toBe("MAKER");
    expect(classifyLiquidity("STOP_LIMIT")).toBe("MAKER");
  });

  it("classifies MARKET as TAKER, even though it's grid's own opt-in timeout fallback", () => {
    // The doc comment is explicit that a grid level's market-fallback conversion is STILL taker,
    // never reclassified as maker just because it originated from a nominally limit-based
    // strategy — this is the specific regression the `backend` skill's fee-model rules call out.
    expect(classifyLiquidity("MARKET")).toBe("TAKER");
  });
});

describe("resolveFeeRate", () => {
  const schedule = { makerRate: 0.006, takerRate: 0.012 };

  it("resolves the maker rate for a resting order type", () => {
    expect(resolveFeeRate(schedule, "LIMIT")).toBe(0.006);
    expect(resolveFeeRate(schedule, "STOP_LIMIT")).toBe(0.006);
  });

  it("resolves the taker rate for a market order", () => {
    expect(resolveFeeRate(schedule, "MARKET")).toBe(0.012);
  });

  it("reads the rate from whatever schedule is passed in, not a live/mutable default", () => {
    // Snapshot-immutability guarantee (see the `backend` skill's fee-model rules): a custom
    // schedule — as a session's own snapshotted `feeSchedule` would be — is used as-is, not
    // merged with or overridden by DEFAULT_FEE_SCHEDULE.
    const custom = { makerRate: 0.001, takerRate: 0.002 };
    expect(resolveFeeRate(custom, "LIMIT")).toBe(0.001);
    expect(resolveFeeRate(custom, "MARKET")).toBe(0.002);
    expect(resolveFeeRate(DEFAULT_FEE_SCHEDULE, "MARKET")).toBe(DEFAULT_FEE_SCHEDULE.takerRate);
  });
});
