import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { isKillSwitchEngaged } from "../services/killSwitch";

export const killSwitchRouter: ExpressRouter = Router();

/**
 * GET /kill-switch — read-only. Added for `tasks-frontend.md` Phase 6.7
 * (a LIVE session's detail view needs to show the global kill-switch
 * state). Deliberately no `POST` here to toggle it — nothing has asked
 * for that yet (see `killSwitch.ts`'s own doc comment), and engaging/
 * releasing it is a more deliberate operator action than this pass's
 * scope; add it if a future task actually needs it.
 */
killSwitchRouter.get("/", async (_req, res) => {
  res.json({ engaged: await isKillSwitchEngaged() });
});
