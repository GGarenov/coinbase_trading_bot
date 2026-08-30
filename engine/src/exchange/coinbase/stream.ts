import type { PricePoint } from "@coinbase-trading-bot/shared";

/**
 * Public, keyless WebSocket access to Coinbase Advanced Trade's real-time
 * ticker feed. Confirmed against current docs (2026-08-30): market-data
 * channels (ticker, candles, level2, heartbeats) work WITHOUT a JWT — this
 * resolves the "confirm WebSocket auth requirements" item PLAN.md flagged
 * as open. A JWT is only needed for the separate user-order-data socket,
 * which this file doesn't touch.
 *
 * IMPORTANT, confirmed empirically (2026-08-30, not documented anywhere I
 * could find): Coinbase's WebSocket market-data channels do not carry
 * `-USDC` product IDs at all — subscribing to "SOL-USDC" on `ticker` OR
 * `market_trades` gets silently coerced server-side to "SOL-USD", and
 * every event arrives tagged "SOL-USD", never "SOL-USDC". REST is
 * unaffected (`rest.ts`'s `fetchCandles`/`fetchProductInfo` both work
 * correctly with "SOL-USDC" directly) — this is WebSocket-specific. Since
 * USDC is tightly pegged to USD, using the USD feed as this project's
 * live/paper price source for a USDC-quoted product is an accurate,
 * pragmatic substitution — but it IS a substitution, not the literal
 * product being traded, so it's made explicit via `toWireProductId` below
 * rather than silently baked into the subscribe call.
 */
const WS_URL = "wss://advanced-trade-ws.coinbase.com";

// Coinbase disconnects a socket that hasn't sent a `subscribe` message
// within 5s of connecting — the "open" handler below sends one immediately
// whenever there's anything to subscribe to, so that window is never at risk.

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

type PriceListener = (point: PricePoint) => void;

interface TickerEnvelope {
  channel: string;
  timestamp: string;
  events?: Array<{
    type: string;
    tickers?: Array<{ product_id: string; price: string }>;
  }>;
}

/**
 * Maps a "logical" product ID (what strategies/sessions trade, e.g.
 * "SOL-USDC") to the "wire" product ID Coinbase's WebSocket actually
 * carries (e.g. "SOL-USD"). See the file-level comment for why this exists.
 */
function toWireProductId(logicalProductId: string): string {
  return logicalProductId.endsWith("-USDC") ? logicalProductId.replace(/-USDC$/, "-USD") : logicalProductId;
}

/**
 * Shared, refcounted WebSocket price feed: multiple sessions subscribing to
 * the same product share ONE underlying subscription, fanned out to every
 * listener watching that product — this is what lets many paper sessions
 * on the same pair run through a single socket instead of one-per-session.
 *
 * Refcounting happens at TWO levels: logical product -> listeners (the
 * level callers care about), and wire product -> logical products (since
 * e.g. both "SOL-USD" and "SOL-USDC" listeners map to the same wire
 * subscription and must not cause it to be double-subscribed or torn down
 * while either still needs it).
 */
export class PriceStream {
  private ws: WebSocket | null = null;
  private connecting = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private readonly listenersByLogicalProduct = new Map<string, Set<PriceListener>>();
  private readonly logicalProductsByWireProduct = new Map<string, Set<string>>();

  /** Subscribes to a product's ticker (by its logical, tradable product ID); returns an unsubscribe function. */
  subscribe(logicalProductId: string, listener: PriceListener): () => void {
    let listeners = this.listenersByLogicalProduct.get(logicalProductId);
    if (!listeners) {
      listeners = new Set();
      this.listenersByLogicalProduct.set(logicalProductId, listeners);
    }
    listeners.add(listener);

    const wireProductId = toWireProductId(logicalProductId);
    let logicalIds = this.logicalProductsByWireProduct.get(wireProductId);
    const isFirstLogicalIdForWireProduct = !logicalIds || logicalIds.size === 0;
    if (!logicalIds) {
      logicalIds = new Set();
      this.logicalProductsByWireProduct.set(wireProductId, logicalIds);
    }
    logicalIds.add(logicalProductId);

    this.ensureConnected();
    if (isFirstLogicalIdForWireProduct) {
      this.sendSubscribe([wireProductId]);
    }

    return () => {
      const current = this.listenersByLogicalProduct.get(logicalProductId);
      if (!current) return;
      current.delete(listener);
      if (current.size > 0) return;

      this.listenersByLogicalProduct.delete(logicalProductId);
      const wireLogicalIds = this.logicalProductsByWireProduct.get(wireProductId);
      wireLogicalIds?.delete(logicalProductId);
      if (wireLogicalIds && wireLogicalIds.size === 0) {
        this.logicalProductsByWireProduct.delete(wireProductId);
        this.sendUnsubscribe([wireProductId]);
      }
    };
  }

  /** Number of distinct logical products currently subscribed to — useful for verifying refcounting in tests. */
  get subscribedProductCount(): number {
    return this.listenersByLogicalProduct.size;
  }

  /** Total listener count across all products — grows with session count, unlike the socket/subscription count above. */
  get totalListenerCount(): number {
    let total = 0;
    for (const set of this.listenersByLogicalProduct.values()) total += set.size;
    return total;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.listenersByLogicalProduct.clear();
    this.logicalProductsByWireProduct.clear();
  }

  private ensureConnected(): void {
    if (this.ws || this.connecting) return;
    this.connecting = true;

    const socket = new WebSocket(WS_URL);
    this.ws = socket;

    socket.addEventListener("open", () => {
      this.connecting = false;
      this.backoffMs = INITIAL_BACKOFF_MS;
      const wireProductIds = Array.from(this.logicalProductsByWireProduct.keys());
      if (wireProductIds.length > 0) this.sendSubscribe(wireProductIds);
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data as string);
    });

    socket.addEventListener("close", () => {
      this.ws = null;
      this.connecting = false;
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      // "close" always follows "error" for a WebSocket, so reconnect there.
    });
  }

  private scheduleReconnect(): void {
    if (this.logicalProductsByWireProduct.size === 0) return; // nothing to reconnect for
    setTimeout(() => this.ensureConnected(), this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
  }

  private sendSubscribe(wireProductIds: string[]): void {
    this.send({ type: "subscribe", product_ids: wireProductIds, channel: "ticker" });
  }

  private sendUnsubscribe(wireProductIds: string[]): void {
    this.send({ type: "unsubscribe", product_ids: wireProductIds, channel: "ticker" });
  }

  private send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return; // will be sent on "open" once connected
    this.ws.send(JSON.stringify(message));
  }

  private handleMessage(raw: string): void {
    let envelope: TickerEnvelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return; // not JSON (shouldn't happen) — ignore rather than crash the stream
    }
    if (envelope.channel !== "ticker" || !envelope.events) return;

    const timestamp = Date.parse(envelope.timestamp);
    for (const evt of envelope.events) {
      for (const ticker of evt.tickers ?? []) {
        const logicalIds = this.logicalProductsByWireProduct.get(ticker.product_id);
        if (!logicalIds) continue;
        const point: PricePoint = { price: Number(ticker.price), timestamp };
        for (const logicalId of logicalIds) {
          const listeners = this.listenersByLogicalProduct.get(logicalId);
          if (!listeners) continue;
          for (const listener of listeners) listener(point);
        }
      }
    }
  }
}
