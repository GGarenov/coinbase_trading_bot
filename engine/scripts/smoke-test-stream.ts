/**
 * Manual smoke test for exchange/coinbase/stream.ts — opens a real
 * WebSocket connection to Coinbase's public ticker feed (no auth) and logs
 * received prices for ~30s, confirming the wrapper works end-to-end.
 */
import { PriceStream } from "../src/exchange/coinbase/stream";

const DURATION_MS = 30_000;

async function main() {
  const stream = new PriceStream();
  let tickCount = 0;

  const unsubscribe = stream.subscribe("SOL-USDC", (point) => {
    tickCount += 1;
    console.log(`[${new Date(point.timestamp).toISOString()}] SOL-USDC: $${point.price}`);
  });

  console.log(`Listening to SOL-USDC ticker for ${DURATION_MS / 1000}s...`);
  await new Promise((resolve) => setTimeout(resolve, DURATION_MS));

  unsubscribe();
  stream.close();

  console.log(`\nReceived ${tickCount} ticks.`);
  if (tickCount === 0) {
    throw new Error("Expected at least one ticker update in 30s");
  }
  console.log("SMOKE TEST (stream.ts): PASSED");
}

main().catch((error) => {
  console.error("SMOKE TEST (stream.ts): FAILED");
  console.error(error);
  process.exitCode = 1;
});
