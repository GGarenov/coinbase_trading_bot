import { createApp } from "./app";
import { resumeRunningSessions } from "./services/sessionManager";

const PORT = Number(process.env.ENGINE_PORT ?? 4000);
// This is a personal, single-user, local tool — binding to 127.0.0.1 only means it's never
// reachable from the network. Part of PLAN.md's live-trading safety posture (see
// docs/tasks-backend.md's "Live-Trading Safety Rails" section); implemented here already since
// this is the first place the engine actually becomes a listening HTTP server.
const HOST = "127.0.0.1";

const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`Engine listening on http://${HOST}:${PORT}`);

  // Reload any session left RUNNING from before this process started (a crash, a restart, or —
  // once pm2 is managing this process — a reboot) and re-subscribe each one, so a crash never
  // silently drops a running paper/live session. Deliberately called AFTER listen() resolves, not
  // before: the HTTP API (health checks, /backtests) becomes available immediately even if
  // resuming a session takes a moment or one of them fails.
  resumeRunningSessions().catch((error) => {
    console.error("[index] resumeRunningSessions() failed:", error);
  });
});
