import crypto from "node:crypto";
import jwt from "jsonwebtoken";

/**
 * JWT (ES256) signing for Coinbase CDP API keys — authenticated access
 * only (live trading). Structurally separate from `rest.ts`/`stream.ts`,
 * which never import this file and never see a key.
 *
 * The `iss`/`sub`/`nbf`/`exp` claims and the `kid`/`nonce` header fields
 * were confirmed against Coinbase's current WebSocket-auth docs
 * (2026-08-30). The additional `uri` claim below (method + host + path,
 * required per-request for REST) is Coinbase's well-documented CDP JWT
 * pattern, but wasn't independently re-confirmed against current docs in
 * this pass — worth a final check against docs.cdp.coinbase.com before
 * this path is ever used for a real order.
 */

const JWT_EXPIRY_SECONDS = 120;

export interface CdpCredentials {
  /** The CDP API key's name/ID, e.g. "organizations/.../apiKeys/...". */
  keyName: string;
  /** The EC (ES256) private key, PEM-encoded. */
  privateKeyPem: string;
}

/** Reads CDP credentials from the environment, or null if not configured — callers must handle the paper/no-live-keys case explicitly. */
export function loadCdpCredentialsFromEnv(): CdpCredentials | null {
  const keyName = process.env.COINBASE_CDP_API_KEY_NAME;
  const privateKeyPem = process.env.COINBASE_CDP_PRIVATE_KEY;
  if (!keyName || !privateKeyPem) return null;
  return { keyName, privateKeyPem };
}

/**
 * Signs a JWT for a specific REST request. `method`/`path` become the
 * `uri` claim Coinbase's REST API expects (e.g. "GET
 * api.coinbase.com/api/v3/brokerage/accounts").
 */
export function signRestRequestJwt(credentials: CdpCredentials, method: string, path: string): string {
  const uri = `${method.toUpperCase()} api.coinbase.com${path}`;
  return signJwt(credentials, { uri });
}

/** Signs a JWT for the WebSocket user-data channel (no per-request `uri` claim — it's a persistent connection, not one request). */
export function signWebSocketJwt(credentials: CdpCredentials): string {
  return signJwt(credentials, {});
}

function signJwt(credentials: CdpCredentials, extraClaims: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "cdp",
    sub: credentials.keyName,
    nbf: now,
    exp: now + JWT_EXPIRY_SECONDS,
    ...extraClaims,
  };

  return jwt.sign(payload, credentials.privateKeyPem, {
    algorithm: "ES256",
    header: {
      alg: "ES256",
      kid: credentials.keyName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonwebtoken's header type doesn't include `nonce`, which Coinbase requires
      nonce: crypto.randomBytes(16).toString("hex"),
    } as any,
  });
}
