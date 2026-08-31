import express, { type Express } from "express";
import { backtestsRouter } from "./routes/backtests";
import { sessionsRouter } from "./routes/sessions";
import { strategiesRouter } from "./routes/strategies";
import { getRunningSessionIds } from "./services/sessionManager";

/**
 * The engine's HTTP API — `/backtests` (Backtesting section), `/health`
 * (Continuous Operation section), and `/strategies` + `/sessions` (HTTP
 * API — Strategy & Session Routes section, added to unblock
 * `tasks-frontend.md`'s dashboard pages). PLAN.md's `configs` and `market`
 * route groups still don't exist; they belong to whichever future section
 * actually needs them.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());

  // A manual liveness check — confirms the process is up and reports how many
  // paper/live sessions this instance is actively subscribed to right now.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: process.uptime(), runningSessionIds: getRunningSessionIds() });
  });

  app.use("/backtests", backtestsRouter);
  app.use("/strategies", strategiesRouter);
  app.use("/sessions", sessionsRouter);
  return app;
}
