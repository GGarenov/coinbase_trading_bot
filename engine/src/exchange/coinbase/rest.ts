import type { Candle, Granularity } from "@coinbase-trading-bot/shared";

/**
 * Public, keyless REST access to Coinbase Advanced Trade's market data.
 * Confirmed against current docs (2026-08-30) — no API key is ever sent
 * from this file, and none is needed: both endpoints below have
 * `security: []` in Coinbase's own OpenAPI spec.
 */
const BASE_URL = "https://api.coinbase.com/api/v3/brokerage";

/** Coinbase's full granularity enum (this project only exposes a subset — see `Granularity`). */
type CoinbaseGranularity =
  | Granularity
  | "ONE_MINUTE"
  | "FIVE_MINUTE"
  | "FIFTEEN_MINUTE"
  | "THIRTY_MINUTE"
  | "TWO_HOUR";

interface RawCandle {
  start: string; // unix seconds, as a string
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface CandlesResponse {
  candles: RawCandle[];
}

/** Coinbase caps a single request at 350 candles. */
const MAX_CANDLES_PER_REQUEST = 350;

function toCandle(raw: RawCandle): Candle {
  return {
    openTime: Number(raw.start) * 1000,
    open: Number(raw.open),
    high: Number(raw.high),
    low: Number(raw.low),
    close: Number(raw.close),
    volume: Number(raw.volume),
  };
}

async function fetchCandlePage(
  productId: string,
  granularity: CoinbaseGranularity,
  startSec: number,
  endSec: number,
): Promise<Candle[]> {
  const url = new URL(`${BASE_URL}/market/products/${encodeURIComponent(productId)}/candles`);
  url.searchParams.set("start", String(startSec));
  url.searchParams.set("end", String(endSec));
  url.searchParams.set("granularity", granularity);
  url.searchParams.set("limit", String(MAX_CANDLES_PER_REQUEST));

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Coinbase candles request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const body = (await res.json()) as CandlesResponse;
  // Coinbase returns candles newest-first; callers want chronological order.
  return body.candles.map(toCandle).sort((a, b) => a.openTime - b.openTime);
}

const GRANULARITY_SECONDS: Record<CoinbaseGranularity, number> = {
  ONE_MINUTE: 60,
  FIVE_MINUTE: 5 * 60,
  FIFTEEN_MINUTE: 15 * 60,
  THIRTY_MINUTE: 30 * 60,
  ONE_HOUR: 60 * 60,
  TWO_HOUR: 2 * 60 * 60,
  SIX_HOUR: 6 * 60 * 60,
  ONE_DAY: 24 * 60 * 60,
};

/**
 * Fetches historical candles for a product over [startMs, endMs], paginating
 * transparently past Coinbase's 350-candles-per-request cap.
 */
export async function fetchCandles(
  productId: string,
  granularity: CoinbaseGranularity,
  startMs: number,
  endMs: number,
): Promise<Candle[]> {
  const stepSec = GRANULARITY_SECONDS[granularity] * MAX_CANDLES_PER_REQUEST;
  const startSec = Math.floor(startMs / 1000);
  const endSec = Math.floor(endMs / 1000);

  const pages: Candle[][] = [];
  for (let pageStart = startSec; pageStart < endSec; pageStart += stepSec) {
    const pageEnd = Math.min(pageStart + stepSec, endSec);
    pages.push(await fetchCandlePage(productId, granularity, pageStart, pageEnd));
  }
  return pages.flat();
}

export interface ProductInfo {
  productId: string;
  /** Smallest increment the base quantity (e.g. SOL) can move by. */
  baseIncrement: number;
  /** Smallest increment the quote price (e.g. USDC) can move by. */
  quoteIncrement: number;
  baseMinSize: number;
  baseMaxSize: number;
  /**
   * Coinbase's current public product-info response doesn't expose a field
   * literally named "min_market_funds" (an earlier API generation had one);
   * `quoteMinSize` is the equivalent minimum-notional check for this API
   * version — confirmed against current docs (2026-08-30).
   */
  quoteMinSize: number;
  quoteMaxSize: number;
}

interface RawProduct {
  product_id: string;
  base_increment: string;
  quote_increment: string;
  base_min_size: string;
  base_max_size: string;
  quote_min_size: string;
  quote_max_size: string;
}

export async function fetchProductInfo(productId: string): Promise<ProductInfo> {
  const url = `${BASE_URL}/market/products/${encodeURIComponent(productId)}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Coinbase product info request failed: ${res.status} ${res.statusText} — ${await res.text()}`);
  }
  const raw = (await res.json()) as RawProduct;
  return {
    productId: raw.product_id,
    baseIncrement: Number(raw.base_increment),
    quoteIncrement: Number(raw.quote_increment),
    baseMinSize: Number(raw.base_min_size),
    baseMaxSize: Number(raw.base_max_size),
    quoteMinSize: Number(raw.quote_min_size),
    quoteMaxSize: Number(raw.quote_max_size),
  };
}
