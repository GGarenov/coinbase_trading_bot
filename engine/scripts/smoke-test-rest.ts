/**
 * Manual smoke test for exchange/coinbase/rest.ts — hits Coinbase's real
 * public REST API (no auth, no orders). Confirms the public REST wrapper
 * works end-to-end against the live API, not just against our own types.
 */
import { fetchCandles, fetchProductInfo } from "../src/exchange/coinbase/rest";

async function main() {
  console.log("Fetching SOL-USDC product info...");
  const product = await fetchProductInfo("SOL-USDC");
  console.log(product);

  console.log("\nFetching the last 24 hours of SOL-USDC 1h candles...");
  const end = Date.now();
  const start = end - 24 * 60 * 60 * 1000;
  const candles = await fetchCandles("SOL-USDC", "ONE_HOUR", start, end);
  console.log(`Got ${candles.length} candles.`);
  console.log("First:", candles[0]);
  console.log("Last: ", candles[candles.length - 1]);

  if (candles.length === 0) {
    throw new Error("Expected at least one candle for a 24h window");
  }
  const chronological = candles.every((c, i) => i === 0 || c.openTime > candles[i - 1].openTime);
  if (!chronological) {
    throw new Error("Candles are not in chronological order");
  }

  console.log("\nSMOKE TEST (rest.ts): PASSED");
}

main().catch((error) => {
  console.error("SMOKE TEST (rest.ts): FAILED");
  console.error(error);
  process.exitCode = 1;
});
