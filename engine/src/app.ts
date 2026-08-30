import express, { type Express } from "express";
import { backtestsRouter } from "./routes/backtests";
import { getRunningSessionIds } from "./services/sessionManager";

/**
 * The engine's HTTP API — `/backtests` (Backtesting section) plus `/health`
 * (Continuous Operation section, this pass). Other route groups from
 * PLAN.md (`strategies`, `configs`, `sessions`, `market`) don't exist yet;
 * they belong to whichever future section actually needs them.
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
  return app;
}
