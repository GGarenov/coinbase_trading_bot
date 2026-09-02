import { z } from "zod";
import type { PortfolioState, PricePoint } from "../types";
import type { StrategyDefinition, StrategyInstance, TradeDecision } from "./types";

export const gridLevelSchema = z.object({
  price: z.number().positive(),
  side: z.enum(["BUY", "SELL"]),
});

export const gridParamsSchema = z
  .object({
    productId: z.string().min(1),
    /** Explicit, manually-configured levels — NOT auto-spaced. Supports wide, non-uniform grids. */
    levels: z.array(gridLevelSchema).min(1),
    /** Quote currency spent when a BUY level triggers, e.g. 25 (USDC). */
    amountPerLevel: z.number().positive(),
    /**
     * How far (as a % of the level's price) price may land past a level and
     * still count as "caught" by the stop-limit-with-buffer, instead of
     * being logged as a missed fill (or handed to the market fallback).
     */
    stopLimitBufferPct: z.number().min(0).max(10).default(0.5),
    /** Off by default — opt-in, since it incurs taker fees. */
    marketFallback: z
      .object({
        enabled: z.boolean().default(false),
        timeoutSeconds: z.number().int().positive().default(300),
      })
      .default({ enabled: false, timeoutSeconds: 300 }),
  })
  .refine((p) => p.levels.some((l) => l.side === "BUY"), {
    message: "levels must include at least one BUY level",
  });

export type GridParams = z.infer<typeof gridParamsSchema>;

type SlotStatus = "idle" | "buyTriggered" | "holding" | "sellTriggered";

interface LevelSlot {
  status: SlotStatus;
  /** ms epoch a pending stop-limit (buy or sell side) started waiting, or null. */
  triggeredAt: number | null;
  /** Base quantity currently held at this slot, once bought. */
  quantity: number | null;
  /** Quote amount paid for that quantity, once bought. */
  costBasis: number | null;
}

interface GridState {
  lastPrice: number | null;
  slots: LevelSlot[];
}

/**
 * Grid Trading over explicit, non-uniform levels (e.g. buy $95/$90, sell
 * $105/$110 on SOL-USDC) — not an auto-spaced grid. BUY levels and SELL
 * levels are configured independently, and are paired by **declaration
 * order** (the first BUY level pairs with the first SELL level, and so on)
 * rather than by sorted price — so `[{95,BUY},{90,BUY}]` /
 * `[{105,SELL},{110,SELL}]` pairs 95↔105 and 90↔110, matching how a user
 * would naturally list "tightest pair first, widest pair last" rather than
 * an arbitrary price-sorted pairing. Extra BUY levels beyond the SELL count
 * accumulate with no configured exit; extra SELL levels beyond the BUY
 * count are simply unreachable. This pairing convention is a first-cut
 * design decision worth revisiting once real backtests are run against it.
 *
 * Each level is a stop-limit-with-buffer, not a plain static limit:
 *  - When price crosses a level, if it lands within `stopLimitBufferPct` of
 *    the level, the order fills immediately (this tick).
 *  - If price gapped further than the buffer, the level waits (up to
 *    `marketFallback.timeoutSeconds`) for price to come back within the
 *    buffer.
 *  - If the timeout elapses first: with `marketFallback.enabled`, the order
 *    converts to a market order (taker fee, logged as such); otherwise the
 *    trigger is abandoned and reported as a `MISSED_FILL` — feeding the
 *    backtest report's "instances of missed fills" metric.
 *
 * Every sell reports the exact `costBasis` of the buy it closes (the quote
 * amount originally spent at that specific level) — this project never
 * relies on FIFO matching across a session's fills. See the FIFO-cost-basis
 * bug note in `strategies/types.ts` for why that matters.
 */
class GridInstance implements StrategyInstance {
  private state: GridState;
  private readonly buyPrices: number[];
  private readonly sellPrices: number[];

  constructor(private readonly params: GridParams) {
    // Declaration order, not sorted — see the class doc comment for why.
    this.buyPrices = params.levels.filter((l) => l.side === "BUY").map((l) => l.price);
    this.sellPrices = params.levels.filter((l) => l.side === "SELL").map((l) => l.price);

    this.state = {
      lastPrice: null,
      slots: this.buyPrices.map(() => ({
        status: "idle",
        triggeredAt: null,
        quantity: null,
        costBasis: null,
      })),
    };
  }

  private bufferAmount(levelPrice: number): number {
    return levelPrice * (this.params.stopLimitBufferPct / 100);
  }

  private timeoutMs(): number {
    return this.params.marketFallback.timeoutSeconds * 1000;
  }

  onPrice(point: PricePoint, _portfolio: PortfolioState): TradeDecision[] {
    const { price, timestamp } = point;
    const decisions: TradeDecision[] = [];
    const { lastPrice, slots } = this.state;

    // First tick only establishes the reference price: a "crossing" needs
    // a before and an after.
    if (lastPrice === null) {
      this.state.lastPrice = price;
      return decisions;
    }

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const buyPrice = this.buyPrices[i];
      const sellPrice = this.sellPrices[i]; // may be undefined — no configured exit for this slot

      if (slot.status === "idle") {
        const crossedDown = lastPrice > buyPrice && price <= buyPrice;
        if (crossedDown) {
          const distance = buyPrice - price;
          if (distance <= this.bufferAmount(buyPrice)) {
            const quantity = this.params.amountPerLevel / price;
            decisions.push({
              kind: "ORDER",
              side: "BUY",
              orderType: "STOP_LIMIT",
              quoteAmount: this.params.amountPerLevel,
              levelPrice: buyPrice,
            });
            slot.status = "holding";
            slot.quantity = quantity;
            slot.costBasis = this.params.amountPerLevel;
          } else {
            slot.status = "buyTriggered";
            slot.triggeredAt = timestamp;
          }
        }
      } else if (slot.status === "buyTriggered") {
        const distance = Math.abs(price - buyPrice);
        if (distance <= this.bufferAmount(buyPrice)) {
          const quantity = this.params.amountPerLevel / price;
          decisions.push({
            kind: "ORDER",
            side: "BUY",
            orderType: "STOP_LIMIT",
            quoteAmount: this.params.amountPerLevel,
            levelPrice: buyPrice,
          });
          slot.status = "holding";
          slot.quantity = quantity;
          slot.costBasis = this.params.amountPerLevel;
          slot.triggeredAt = null;
        } else if (timestamp - slot.triggeredAt! >= this.timeoutMs()) {
          if (this.params.marketFallback.enabled) {
            const quantity = this.params.amountPerLevel / price;
            decisions.push({
              kind: "ORDER",
              side: "BUY",
              orderType: "MARKET",
              quoteAmount: this.params.amountPerLevel,
              levelPrice: buyPrice,
            });
            slot.status = "holding";
            slot.quantity = quantity;
            slot.costBasis = this.params.amountPerLevel;
          } else {
            decisions.push({
              kind: "MISSED_FILL",
              side: "BUY",
              levelPrice: buyPrice,
              reason: "stop-limit-with-buffer timed out with no market fallback configured",
            });
            slot.status = "idle";
          }
          slot.triggeredAt = null;
        }
        // else: still within the timeout window, keep waiting.
      } else if (sellPrice !== undefined && slot.status === "holding") {
        const crossedUp = lastPrice < sellPrice && price >= sellPrice;
        if (crossedUp) {
          const distance = price - sellPrice;
          if (distance <= this.bufferAmount(sellPrice)) {
            decisions.push({
              kind: "ORDER",
              side: "SELL",
              orderType: "STOP_LIMIT",
              quantity: slot.quantity!,
              costBasis: slot.costBasis!,
              levelPrice: sellPrice,
              closingLevelPrice: buyPrice,
            });
            slot.status = "idle";
            slot.quantity = null;
            slot.costBasis = null;
          } else {
            slot.status = "sellTriggered";
            slot.triggeredAt = timestamp;
          }
        }
      } else if (sellPrice !== undefined && slot.status === "sellTriggered") {
        const distance = Math.abs(price - sellPrice);
        if (distance <= this.bufferAmount(sellPrice)) {
          decisions.push({
            kind: "ORDER",
            side: "SELL",
            orderType: "STOP_LIMIT",
            quantity: slot.quantity!,
            costBasis: slot.costBasis!,
            levelPrice: sellPrice,
            closingLevelPrice: buyPrice,
          });
          slot.status = "idle";
          slot.quantity = null;
          slot.costBasis = null;
          slot.triggeredAt = null;
        } else if (timestamp - slot.triggeredAt! >= this.timeoutMs()) {
          if (this.params.marketFallback.enabled) {
            decisions.push({
              kind: "ORDER",
              side: "SELL",
              orderType: "MARKET",
              quantity: slot.quantity!,
              costBasis: slot.costBasis!,
              levelPrice: sellPrice,
              closingLevelPrice: buyPrice,
            });
            slot.status = "idle";
            slot.quantity = null;
            slot.costBasis = null;
          } else {
            decisions.push({
              kind: "MISSED_FILL",
              side: "SELL",
              levelPrice: sellPrice,
              reason: "stop-limit-with-buffer timed out with no market fallback configured",
            });
            // Still holding the position — a missed exit doesn't lose the position, unlike a missed entry.
            slot.status = "holding";
          }
          slot.triggeredAt = null;
        }
        // else: still within the timeout window, keep waiting.
      }
    }

    this.state.lastPrice = price;
    return decisions;
  }

  getState(): GridState {
    return {
      lastPrice: this.state.lastPrice,
      slots: this.state.slots.map((s) => ({ ...s })),
    };
  }

  setState(state: unknown): void {
    this.state = state as GridState;
  }
}

export const gridStrategy: StrategyDefinition<GridParams> = {
  slug: "grid",
  paramsSchema: gridParamsSchema,
  create: (params) => new GridInstance(params),
};
