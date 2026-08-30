import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7's CLI (generate/migrate) needs its own connection config here,
// separate from the driver-adapter connection PrismaClient uses at runtime
// (see src/prisma.ts). Both point at the same file: the repo-root data/
// directory, which is where the running engine's bot.db lives.
const dbPath = path.join(__dirname, "..", "..", "data", "bot.db");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: `file:${dbPath}`,
  },
});
