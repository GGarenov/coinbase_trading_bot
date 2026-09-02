import express, { type Express } from "express";
import { backtestsRouter } from "./routes/backtests";
import { configsRouter } from "./routes/configs";
import { killSwitchRouter } from "./routes/killSwitch";
import { sessionsRouter } from "./routes/sessions";
import { strategiesRouter } from "./routes/strategies";
import { getRunningSessionIds } from "./services/sessionManager";

// web/'s Client Components (e.g. Phase 4's ConfigForm) call this API directly from the browser via
// `fetch`, not just server-side from a Next.js Server Component — that's a genuinely cross-origin
// request (different port = different origin), first exercised when Phase 4 actually clicked a
// button: the browser's CORS preflight (OPTIONS) got Express's default 200 (it auto-responds with
// an `Allow` header for a registered path), but the real POST was then blocked client-side with no
// `Access-Control-Allow-Origin` header ever having been sent. Both processes are bound to
// 127.0.0.1 only regardless (see index.ts), so this is purely about satisfying the browser's
// same-origin policy for a same-machine dev setup, not a real network-exposure concern — hence an
// explicit origin allow-list rather than `Access-Control-Allow-Origin: *`.
const ALLOWED_ORIGINS = new Set([process.env.WEB_ORIGIN, "http://127.0.0.1:3000", "http://localhost:3000"].filter((v): v is string => Boolean(v)));

/**
 * The engine's HTTP API — `/backtests` (Backtesting section), `/health`
 * (Continuous Operation section), `/strategies` + `/sessions` (HTTP API —
 * Strategy & Session Routes section), `/configs` (HTTP API — Strategy
 * Config Route section, added to unblock `tasks-frontend.md` Phase 4), and
 * `/kill-switch` (read-only, added to unblock Phase 6.7's LIVE-session
 * indicator). PLAN.md's `market` route group still doesn't exist; it
 * belongs to whichever future section actually needs it.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.has(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // A manual liveness check — confirms the process is up and reports how many
  // paper/live sessions this instance is actively subscribed to right now.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: process.uptime(), runningSessionIds: getRunningSessionIds() });
  });

  app.use("/backtests", backtestsRouter);
  app.use("/strategies", strategiesRouter);
  app.use("/sessions", sessionsRouter);
  app.use("/configs", configsRouter);
  app.use("/kill-switch", killSwitchRouter);
  return app;
}
