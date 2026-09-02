/**
 * Manual smoke test for the /configs, /strategies, and /sessions HTTP
 * routes (routes/configs.ts, routes/strategies.ts, routes/sessions.ts,
 * app.ts) — added to unblock tasks-frontend.md's dashboard pages (see
 * tasks-backend.md's "HTTP API — Strategy & Session Routes" and "HTTP API
 * — Strategy Config Route" sections). Makes real HTTP requests against a
 * locally-started instance of the actual engine app, creates a real
 * StrategyConfig through the HTTP API (no direct Prisma access — this is
 * the exact path the dashboard's config form will use), starts a real
 * PAPER session against Coinbase's live SOL-USDC ticker feed, and
 * exercises the full start -> pause -> resume -> stop lifecycle plus the
 * compare route.
 *
 * Uses "dca" configured to buy immediately, same reasoning as
 * smoke-test-session-manager.ts: guaranteed to produce a fill on the very
 * first tick rather than depending on a live price crossing a level within
 * this test's short run time.
 */
import { prisma } from "@coinbase-trading-bot/shared/server";
import { createApp } from "../src/app";
import { priceStream } from "../src/services/sessionManager";

const RUN_MS = 10_000;
const PRODUCT_ID = "SOL-USDC";

async function main() {
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let strategyConfigId: number | undefined;
  let sessionId: number | undefined;
  try {
    // --- GET /strategies + GET /strategies/:slug ---
    const catalogRes = await fetch(`${baseUrl}/strategies`);
    if (!catalogRes.ok) throw new Error(`Expected 200 from GET /strategies, got ${catalogRes.status}`);
    const catalog = (await catalogRes.json()) as Array<{ slug: string; paramsSchema: unknown }>;
    if (catalog.length !== 4) throw new Error(`Expected 4 seeded strategies, got ${catalog.length}`);
    const dcaEntry = catalog.find((s) => s.slug === "dca");
    if (!dcaEntry?.paramsSchema) throw new Error("Expected the dca catalog entry to have a populated paramsSchema");
    console.log(`GET /strategies: 200, ${catalog.length} strategies, each with a paramsSchema`);

    const oneRes = await fetch(`${baseUrl}/strategies/dca`);
    if (!oneRes.ok) throw new Error(`Expected 200 from GET /strategies/dca, got ${oneRes.status}`);
    console.log("GET /strategies/dca: 200");

    const missingRes = await fetch(`${baseUrl}/strategies/not-a-real-slug`);
    if (missingRes.status !== 404) throw new Error(`Expected 404 for an unknown slug, got ${missingRes.status}`);
    console.log("GET /strategies/not-a-real-slug: 404, as expected");

    // --- POST /configs ---
    const badConfigRes = await fetch(`${baseUrl}/configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ strategySlug: "dca", params: { productId: PRODUCT_ID /* missing amountPerBuy/interval/durationDays */ } }),
    });
    if (badConfigRes.status !== 400) throw new Error(`Expected 400 for params failing dca's own schema, got ${badConfigRes.status}`);
    console.log("POST /configs (invalid params): 400, as expected");

    const configRes = await fetch(`${baseUrl}/configs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategySlug: "dca",
        name: "smoke-test-sessions-api (ephemeral)",
        params: { productId: PRODUCT_ID, amountPerBuy: 10, interval: "daily", durationDays: 1 },
      }),
    });
    if (configRes.status !== 201) throw new Error(`Expected 201 from POST /configs, got ${configRes.status}: ${await configRes.text()}`);
    const config = (await configRes.json()) as { id: number };
    strategyConfigId = config.id;
    console.log(`POST /configs: 201, config ${strategyConfigId}`);

    // --- POST /sessions ---
    const createRes = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        strategyConfigId,
        productId: PRODUCT_ID,
        mode: "PAPER",
        initialQuoteBalance: 1000,
        initialBaseBalance: 0,
      }),
    });
    if (createRes.status !== 201) throw new Error(`Expected 201 from POST /sessions, got ${createRes.status}: ${await createRes.text()}`);
    const created = (await createRes.json()) as { sessionId: number; status: string };
    sessionId = created.sessionId;
    if (created.status !== "RUNNING") throw new Error(`Expected status RUNNING right after start, got ${created.status}`);
    console.log(`POST /sessions: 201, session ${sessionId} RUNNING`);

    console.log(`Waiting ${RUN_MS / 1000}s for a real tick + the immediate DCA buy...`);
    await new Promise((resolve) => setTimeout(resolve, RUN_MS));

    // --- GET /sessions (list) ---
    const listRes = await fetch(`${baseUrl}/sessions`);
    if (!listRes.ok) throw new Error(`Expected 200 from GET /sessions, got ${listRes.status}`);
    const list = (await listRes.json()) as Array<{ id: number }>;
    if (!list.some((s) => s.id === sessionId)) throw new Error(`Expected session ${sessionId} in GET /sessions`);
    console.log(`GET /sessions: 200, session ${sessionId} present among ${list.length} session(s)`);

    // --- GET /sessions/:id (detail) ---
    const detailRes = await fetch(`${baseUrl}/sessions/${sessionId}`);
    if (!detailRes.ok) throw new Error(`Expected 200 from GET /sessions/:id, got ${detailRes.status}`);
    const detail = (await detailRes.json()) as {
      currentPrice: number | null;
      quoteBalance: number;
      feesPaid: number;
      recentOrders: Array<{ price: number | null; size: number | null; fills: Array<{ price: number; size: number; fee: number }> }>;
      isRunningInThisProcess: boolean;
    };
    if (!detail.isRunningInThisProcess) throw new Error("Expected isRunningInThisProcess to be true right after starting");
    if (detail.currentPrice === null) throw new Error("Expected a live currentPrice from the running session's last tick");
    if (detail.quoteBalance >= 1000) throw new Error(`Expected quoteBalance to have dropped below 1000 after the immediate DCA buy, got ${detail.quoteBalance}`);
    if (detail.feesPaid <= 0) throw new Error(`Expected feesPaid > 0 after a fill, got ${detail.feesPaid}`);
    if (detail.recentOrders.length === 0) throw new Error("Expected at least one order in recentOrders");
    // Prisma's Decimal fields serialize to JSON as strings by default (decimal.js's own toJSON) —
    // routes/sessions.ts explicitly converts them with Number(...) before responding, so a naive
    // `typeof` check here catches a regression if that conversion is ever accidentally dropped.
    const firstFill = detail.recentOrders[0].fills[0];
    if (typeof firstFill.price !== "number" || typeof firstFill.size !== "number" || typeof firstFill.fee !== "number") {
      throw new Error(`Expected recentOrders[].fills[].price/size/fee to be numbers, got ${JSON.stringify(firstFill)}`);
    }
    console.log(`GET /sessions/${sessionId}: 200, currentPrice=${detail.currentPrice}, quoteBalance=${detail.quoteBalance}, feesPaid=${detail.feesPaid}, fill price/size/fee are numbers (not Decimal strings)`);

    // --- GET /sessions/compare ---
    const compareRes = await fetch(`${baseUrl}/sessions/compare`);
    if (!compareRes.ok) throw new Error(`Expected 200 from GET /sessions/compare, got ${compareRes.status}`);
    const compare = (await compareRes.json()) as { sessions: Array<{ sessionId: number; equityCurve: unknown[] }> };
    const compareRow = compare.sessions.find((s) => s.sessionId === sessionId);
    if (!compareRow) throw new Error(`Expected session ${sessionId} in GET /sessions/compare`);
    if (compareRow.equityCurve.length === 0) throw new Error("Expected a non-empty equityCurve in the compare row (should include the live 'now' point)");
    console.log(`GET /sessions/compare: 200, session ${sessionId} present with a ${compareRow.equityCurve.length}-point equity curve`);

    // --- POST /sessions/:id/pause, then /start (resume), then /stop ---
    const pauseRes = await fetch(`${baseUrl}/sessions/${sessionId}/pause`, { method: "POST" });
    if (!pauseRes.ok) throw new Error(`Expected 200 from POST /sessions/:id/pause, got ${pauseRes.status}`);
    const afterPause = await fetch(`${baseUrl}/sessions/${sessionId}`).then((r) => r.json() as Promise<{ status: string; isRunningInThisProcess: boolean }>);
    if (afterPause.status !== "PAUSED" || afterPause.isRunningInThisProcess) throw new Error(`Expected PAUSED + not running, got status=${afterPause.status} running=${afterPause.isRunningInThisProcess}`);
    console.log(`POST /sessions/${sessionId}/pause: session PAUSED, unsubscribed`);

    const resumeRes = await fetch(`${baseUrl}/sessions/${sessionId}/start`, { method: "POST" });
    if (!resumeRes.ok) throw new Error(`Expected 200 from POST /sessions/:id/start, got ${resumeRes.status}`);
    const resumeBody = (await resumeRes.json()) as { status: string };
    if (resumeBody.status !== "RUNNING") throw new Error(`Expected RUNNING after resume, got ${resumeBody.status}`);
    console.log(`POST /sessions/${sessionId}/start: resumed, RUNNING again`);

    const stopRes = await fetch(`${baseUrl}/sessions/${sessionId}/stop`, { method: "POST" });
    if (!stopRes.ok) throw new Error(`Expected 200 from POST /sessions/:id/stop, got ${stopRes.status}`);
    const afterStop = await fetch(`${baseUrl}/sessions/${sessionId}`).then((r) => r.json() as Promise<{ status: string }>);
    if (afterStop.status !== "STOPPED") throw new Error(`Expected STOPPED, got ${afterStop.status}`);
    console.log(`POST /sessions/${sessionId}/stop: session STOPPED`);

    console.log("SMOKE TEST (configs/strategies/sessions HTTP routes): PASSED");
  } finally {
    server.close();
    priceStream.close();
    if (sessionId !== undefined) {
      await prisma.trade.deleteMany({ where: { sessionId } });
      await prisma.fill.deleteMany({ where: { order: { sessionId } } });
      await prisma.missedFill.deleteMany({ where: { sessionId } });
      await prisma.balance.deleteMany({ where: { sessionId } });
      await prisma.order.deleteMany({ where: { sessionId } });
      await prisma.session.delete({ where: { id: sessionId } });
    }
    if (strategyConfigId !== undefined) {
      await prisma.strategyConfig.delete({ where: { id: strategyConfigId } });
    }
  }
}

main()
  .catch((error) => {
    console.error("SMOKE TEST (configs/strategies/sessions HTTP routes): FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
