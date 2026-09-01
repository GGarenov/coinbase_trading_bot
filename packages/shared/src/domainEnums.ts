/**
 * Plain string-literal mirrors of `schema.prisma`'s enums, kept here — not
 * imported from `@prisma/client` — specifically so `web/` can use them.
 * `@prisma/client`'s generated types come bundled with the native
 * `better-sqlite3` driver adapter; importing them (even just for a type)
 * would pull that native binding into anything that imports this package,
 * including a browser bundle, which can't load it at all. See `prisma.ts`'s
 * own doc comment and this package's `server.ts` for where the real,
 * DB-connected `prisma` client lives instead.
 *
 * These MUST be kept in sync with `prisma/schema.prisma` by hand — there's
 * no codegen link between the two, since the whole point is to avoid
 * depending on Prisma's generated output here.
 */

export type SessionMode = "BACKTEST" | "PAPER" | "LIVE";

export type SessionStatus = "PENDING" | "RUNNING" | "PAUSED" | "STOPPED" | "COMPLETED" | "FAILED";

export type OrderSide = "BUY" | "SELL";

export type OrderStatus = "OPEN" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "EXPIRED" | "REJECTED";
