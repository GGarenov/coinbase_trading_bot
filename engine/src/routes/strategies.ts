import { getStrategyDefinition } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";

export const strategiesRouter: ExpressRouter = Router();

/**
 * A catalog row shaped for the dashboard's strategy library card + config
 * form (`tasks-frontend.md` Phase 3.2/4.1). `paramsSchema` is converted from
 * the strategy's runtime Zod schema to JSON Schema via Zod 4's native
 * `z.toJSONSchema()` — no extra dependency needed, and it's derived from the
 * exact same schema `startSession()` validates against, so the form the
 * dashboard renders can never drift out of sync with what the engine
 * actually accepts. `null` only if a `Strategy` row exists in the DB with no
 * matching registry entry (shouldn't happen outside a bad manual DB edit).
 */
function toCatalogEntry(row: { id: number; slug: string; name: string; description: string; riskLevel: string; defaultParams: unknown }) {
  const definition = getStrategyDefinition(row.slug);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    riskLevel: row.riskLevel,
    defaultParams: row.defaultParams,
    paramsSchema: definition ? z.toJSONSchema(definition.paramsSchema) : null,
  };
}

/** GET /strategies — the full strategy catalog, for the library cards on `page.tsx`. */
strategiesRouter.get("/", async (_req, res) => {
  const strategies = await prisma.strategy.findMany({ orderBy: { id: "asc" } });
  res.json(strategies.map(toCatalogEntry));
});

/**
 * GET /strategies/:slug — a single strategy by slug, for
 * `strategies/[slug]/page.tsx`'s config form. Not explicitly asked for in
 * `tasks-backend.md`'s bullet list (which only names `GET /strategies`),
 * but added here since it's a trivial slice of the same query and directly
 * serves `tasks-frontend.md` Phase 4.1 ("fetch the strategy definition +
 * paramsSchema by slug") without the dashboard fetching the whole catalog
 * just to find one entry.
 */
strategiesRouter.get("/:slug", async (req, res) => {
  const strategy = await prisma.strategy.findUnique({ where: { slug: req.params.slug } });
  if (!strategy) {
    res.status(404).json({ error: `No strategy with slug "${req.params.slug}"` });
    return;
  }
  res.json(toCatalogEntry(strategy));
});
