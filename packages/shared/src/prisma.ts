import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

// Prisma 7's client no longer connects via a `url` in the schema's
// datasource block — it needs an explicit driver adapter. This resolves
// to the same repo-root data/bot.db file that prisma.config.ts points the
// CLI (generate/migrate) at, and that the running engine process reads
// from and writes to.
const dbPath = path.join(__dirname, "..", "..", "..", "data", "bot.db");

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  return new PrismaClient({ adapter });
}

// Singleton so hot-reloading dev processes (and multiple imports across the
// engine) don't each open their own SQLite connection.
export const prisma: PrismaClient = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
