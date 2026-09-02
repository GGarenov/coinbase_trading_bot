import { getStrategyDefinition } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { Router } from "express";
import type { Router as ExpressRouter } from "express";
import { z } from "zod";

export const configsRouter: ExpressRouter = Router();

const createConfigSchema = z.object({
  strategySlug: z.string().min(1),
  // Optional — a config form doesn't need to force the user to name their param set. Defaults to
  // "<strategy name> — <timestamp>" server-side when omitted, purely for the DB row and any future
  // "reuse a saved config" UI; never shown as a required field on the config form.
  name: z.string().min(1).optional(),
  // Validated below against the strategy's OWN paramsSchema, not a generic shape here — every
  // strategy's params are structurally different (see packages/shared/src/strategies/*.ts).
  params: z.unknown(),
});

/**
 * POST /configs — creates a `StrategyConfig` row from a filled-out config
 * form, so it has an `id` to hand to `POST /backtests` / `POST /sessions`
 * (both require an EXISTING `strategyConfigId` — there was previously no
 * way to create one via HTTP at all; see `tasks-frontend.md`'s Phase 2
 * verification note and Phase 4's blocker note for how this was found).
 *
 * `params` is validated against the strategy's actual Zod `paramsSchema`
 * (the same schema `GET /strategies`'s `paramsSchema` JSON Schema was
 * generated from, and the same one `startSession()`/`runBacktest()`
 * re-validate against when the session actually starts) — so a config that
 * fails here would also fail later, just with a worse error and a stray DB
 * row. Rejecting it here, before creation, is strictly better feedback for
 * the config form to show inline.
 */
configsRouter.post("/", async (req, res) => {
  const parsed = createConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }
  const body = parsed.data;

  const strategy = await prisma.strategy.findUnique({ where: { slug: body.strategySlug } });
  if (!strategy) {
    res.status(404).json({ error: `No strategy with slug "${body.strategySlug}"` });
    return;
  }

  const definition = getStrategyDefinition(strategy.slug);
  if (!definition) {
    // A Strategy DB row with no matching registry entry — a misconfigured deploy, not a user
    // error, so this is a 500, not a 400.
    res.status(500).json({ error: `Strategy "${strategy.slug}" has no matching registry entry` });
    return;
  }

  const paramsResult = definition.paramsSchema.safeParse(body.params);
  if (!paramsResult.success) {
    res.status(400).json({ error: "params failed the strategy's own validation", details: paramsResult.error.flatten() });
    return;
  }

  const config = await prisma.strategyConfig.create({
    data: {
      strategyId: strategy.id,
      name: body.name ?? `${strategy.name} — ${new Date().toISOString()}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- params is validated above against the strategy's own schema; Prisma's generated Json input type doesn't structurally recognize the result
      params: paramsResult.data as any,
    },
  });

  res.status(201).json({ id: config.id, strategyId: config.strategyId, name: config.name, params: config.params });
});
