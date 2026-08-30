import express, { type Express } from "express";
import { backtestsRouter } from "./routes/backtests";

/**
 * The engine's HTTP API — currently just the `/backtests` routes this
 * pass's task list asked for. Other route groups from PLAN.md
 * (`strategies`, `configs`, `sessions`, `market`) don't exist yet; they
 * belong to whichever future section actually needs them (the dashboard's
 * "Continuous Operation" work is the next thing that touches this file,
 * to add a `/health` endpoint and wire in `resumeRunningSessions()`).
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/backtests", backtestsRouter);
  return app;
}
