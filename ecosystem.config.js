// pm2 process config for the engine — the always-on backend process. Run via `pnpm run
// pm2:start` (see root package.json). Runs the engine straight from its TypeScript source via
// tsx's Node loader hook (`node --import tsx`) — there's no build/compile step in this project
// yet, so pm2 needs to be told how to execute .ts directly, same as `pnpm run dev` does with
// `tsx watch`.
const path = require("path");

module.exports = {
  apps: [
    {
      name: "coinbase-trading-bot-engine",
      cwd: path.join(__dirname, "engine"),
      script: "src/index.ts",
      interpreter: "node",
      interpreter_args: "--import tsx",
      env: {
        NODE_ENV: "development",
      },
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      watch: false,
    },
  ],
};
