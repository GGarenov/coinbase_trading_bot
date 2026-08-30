import { type CdpCredentials, loadCdpCredentialsFromEnv, signRestRequestJwt } from "./auth";

/**
 * Authenticated Coinbase Advanced Trade REST access — LIVE TRADING ONLY.
 * Structurally separate from the public `rest.ts`/`stream.ts` clients: no
 * shared client instance, and this one is lazily constructed only when CDP
 * key env vars are present, so a paper-only deployment never even builds
 * an authenticated client.
 */
const BASE_URL = "https://api.coinbase.com/api/v3/brokerage";

export interface PlaceOrderParams {
  productId: string;
  side: "BUY" | "SELL";
  clientOrderId: string;
  /** Limit price; omit for a market order. */
  limitPrice?: string;
  /** Base size for a limit/stop-limit order or a market sell. */
  baseSize?: string;
  /** Quote size for a market buy (spend this much quote currency). */
  quoteSize?: string;
  /** Stop trigger price, for a stop-limit order. */
  stopPrice?: string;
}

export interface PlaceOrderResult {
  orderId: string;
  success: boolean;
  failureReason?: string;
}

export interface Balance {
  currency: string;
  availableValue: number;
}

export class CoinbaseTradingClient {
  constructor(private readonly credentials: CdpCredentials) {}

  private async authedFetch(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
    const jwtToken = signRestRequestJwt(this.credentials, method, path);
    return fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    const orderConfiguration = buildOrderConfiguration(params);
    const res = await this.authedFetch("POST", "/orders", {
      client_order_id: params.clientOrderId,
      product_id: params.productId,
      side: params.side,
      order_configuration: orderConfiguration,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shaping a third-party response, not worth a full type here
    const body = (await res.json()) as any;
    return {
      orderId: body.order_id ?? body.success_response?.order_id ?? "",
      success: body.success === true,
      failureReason: body.error_response?.error_details ?? body.failure_reason,
    };
  }

  async cancelOrders(orderIds: string[]): Promise<void> {
    await this.authedFetch("POST", "/orders/batch_cancel", { order_ids: orderIds });
  }

  async listBalances(): Promise<Balance[]> {
    const res = await this.authedFetch("GET", "/accounts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shaping a third-party response, not worth a full type here
    const body = (await res.json()) as any;
    return (body.accounts ?? []).map((account: any) => ({
      currency: account.currency,
      availableValue: Number(account.available_balance?.value ?? 0),
    }));
  }
}

function buildOrderConfiguration(params: PlaceOrderParams): Record<string, unknown> {
  if (params.stopPrice && params.limitPrice) {
    return {
      stop_limit_stop_limit_gtc: {
        base_size: params.baseSize,
        limit_price: params.limitPrice,
        stop_price: params.stopPrice,
        stop_direction: params.side === "BUY" ? "STOP_DIRECTION_STOP_UP" : "STOP_DIRECTION_STOP_DOWN",
      },
    };
  }
  if (params.limitPrice) {
    return {
      limit_limit_gtc: {
        base_size: params.baseSize,
        limit_price: params.limitPrice,
      },
    };
  }
  return {
    market_market_ioc: {
      base_size: params.baseSize,
      quote_size: params.quoteSize,
    },
  };
}

let cachedClient: CoinbaseTradingClient | null | undefined;

/** Returns the authenticated trading client, or null if no CDP credentials are configured (paper-only deployment). */
export function getTradingClient(): CoinbaseTradingClient | null {
  if (cachedClient === undefined) {
    const credentials = loadCdpCredentialsFromEnv();
    cachedClient = credentials ? new CoinbaseTradingClient(credentials) : null;
  }
  return cachedClient;
}
