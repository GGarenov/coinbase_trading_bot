import { describe, expect, it } from "vitest";
import { maCrossoverStrategy, type MaCrossoverParams } from "./maCrossover";
import type { PortfolioState } from "../types";
import type { TradeDecision } from "./types";

// Ported and adapted from the earlier Binance-based iteration of this
// project's `maCrossover.test.ts`: field names `pair`/`shortPeriod`/
// `longPeriod` -> `productId`/`fastPeriod`/`slowPeriod`, and decisions now
// use the `{kind: "ORDER", side, orderType, ...}` shape (with a required
// `costBasis` on sells) instead of the old bare `{side, ...}` shape.

const HOUR_MS = 60 * 60 * 1000;
const portfolio: PortfolioState = { quoteBalance: 10_000, baseBalance: 0 };

const params: MaCrossoverParams = {
  productId: "SOL-USDC",
  granularity: "ONE_HOUR",
  fastPeriod: 2,
  slowPeriod: 4,
  amountPerEntry: 500,
};

/** Feeds hourly prices, returns all decisions in order. */
function run(instance: ReturnType<typeof maCrossoverStrategy.create>, prices: number[]) {
  const decisions: TradeDecision[] = [];
  prices.forEach((price, i) => {
    decisions.push(...instance.onPrice({ price, timestamp: i * HOUR_MS }, portfolio));
  });
  return decisions;
}

describe("MA Crossover strategy", () => {
  it("makes no decisions before the slow average has enough data", () => {
    const ma = maCrossoverStrategy.create(params, 0);
    expect(run(ma, [100, 100, 100])).toEqual([]); // slowPeriod=4 needs 4 samples
  });

  it("buys when the fast average crosses above the slow, sells when it crosses back", () => {
    const ma = maCrossoverStrategy.create(params, 0);
    // Falling series establishes fast<slow, then a sharp rise crosses up,
    // then a sharp fall crosses down again.
    const decisions = run(ma, [110, 108, 106, 104, 102, 120, 130, 90, 80]);

    expect(decisions).toHaveLength(2);
    expect(decisions[0]).toMatchObject({ kind: "ORDER", side: "BUY", orderType: "MARKET", quoteAmount: 500 });
    // The sell closes exactly what the buy opened: same quoteAmount as costBasis, same quantity.
    const buyPrice = 120; // the price on the tick the buy decision fires at
    expect(decisions[1]).toEqual({
      kind: "ORDER",
      side: "SELL",
      orderType: "MARKET",
      quantity: 500 / buyPrice,
      costBasis: 500,
    });
  });

  it("does not re-buy while already holding during a continued uptrend", () => {
    const ma = maCrossoverStrategy.create(params, 0);
    const decisions = run(ma, [110, 108, 106, 104, 102, 120, 130, 140, 150, 160]);
    expect(decisions.filter((d) => d.kind === "ORDER" && d.side === "BUY")).toHaveLength(1);
  });

  it("ignores prices arriving more often than the configured granularity's sample interval", () => {
    const ma = maCrossoverStrategy.create(params, 0);
    // Two ticks in the same hour: the second must be ignored.
    ma.onPrice({ price: 100, timestamp: 0 }, portfolio);
    ma.onPrice({ price: 999, timestamp: 1000 }, portfolio); // 1 second later
    const state = ma.getState() as { closes: number[] };
    expect(state.closes).toEqual([100]);
  });

  it("resumes from a snapshot without repeating the buy", () => {
    const ma = maCrossoverStrategy.create(params, 0);
    run(ma, [110, 108, 106, 104, 102, 120, 130]); // bought during the rise
    const snapshot = ma.getState();

    const resumed = maCrossoverStrategy.create(params, 0);
    resumed.setState(snapshot);
    // Continued uptrend after restart: no second buy.
    const decisions = resumed.onPrice({ price: 140, timestamp: 100 * HOUR_MS }, portfolio);
    expect(decisions).toEqual([]);
  });
});
