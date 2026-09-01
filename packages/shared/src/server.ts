/**
 * Server-only entry point — everything the main package barrel (`.`)
 * exports, PLUS the real, DB-connected `prisma` client.
 *
 * Import from `@coinbase-trading-bot/shared/server` (never the package
 * root) anywhere that's actually allowed to touch `data/bot.db` —
 * `engine/` and this package's own `prisma/seed.ts`/scripts, never `web/`.
 * Kept as a separate subpath (see `package.json`'s `exports` map) so it's
 * not just a convention but an enforced one: `web/`'s bundler literally
 * cannot resolve `prisma` through the package root, so a future page can't
 * accidentally drag `@prisma/client` / `better-sqlite3`'s native binding
 * into a browser bundle just by importing an unrelated type from the main
 * barrel. See the `frontend` skill's API-client-only rule and
 * `prisma.ts`'s own doc comment.
 */
export * from "./index";
export { prisma } from "./prisma";
