import { createApp } from "./app";

const PORT = Number(process.env.ENGINE_PORT ?? 4000);
// This is a personal, single-user, local tool — binding to 127.0.0.1 only means it's never
// reachable from the network. Part of PLAN.md's live-trading safety posture (see
// docs/tasks-backend.md's "Live-Trading Safety Rails" section); implemented here already since
// this is the first place the engine actually becomes a listening HTTP server.
const HOST = "127.0.0.1";

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Engine listening on http://${HOST}:${PORT}`);
});

// NOTE: resumeRunningSessions() (services/sessionManager.ts) is intentionally NOT wired in here
// yet — that's a separate, explicit "Continuous Operation" section task in tasks-backend.md, not
// part of this pass.
