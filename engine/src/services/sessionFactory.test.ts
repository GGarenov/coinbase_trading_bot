import { DEFAULT_FEE_SCHEDULE } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createSession } from "./sessionFactory";

// (Proposed, tasks-qa.md Phase 6.2) — asserts the fee-schedule-snapshot
// immutability guarantee the `backend` skill's fee-model rules describe:
// "feeSchedule is snapshotted onto the Session row at creation time. Never
// re-read a live/mutable default fee config mid-session — changing your
// account's Coinbase volume tier later must not retroactively alter an
// in-progress or historical session's reported fees." Touches the real dev
// DB, same convention as sessionManager.test.ts (Phase 6.1) and every
// `engine/scripts/smoke-test-*.ts` script.

// DEFAULT_FEE_SCHEDULE is a shared, mutable module-level object (not
// Object.frozen) — this test deliberately mutates it to simulate "the
// account's fee tier changed", then restores the original values so no
// other test sharing this Vitest worker's module registry (e.g.
// packages/shared's fees.test.ts, if ever run in the same process) is
// affected by a leftover mutation.
const originalDefaults = { ...DEFAULT_FEE_SCHEDULE };
afterEach(() => {
  Object.assign(DEFAULT_FEE_SCHEDULE, originalDefaults);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createSession() — feeSchedule snapshot immutability (Phase 6.2)", () => {
  it("keeps an already-created session's stored feeSchedule unchanged after DEFAULT_FEE_SCHEDULE is mutated", async () => {
    const strategy = await prisma.strategy.findUniqueOrThrow({ where: { slug: "dca" } });
    const strategyConfig = await prisma.strategyConfig.create({
      data: {
        strategyId: strategy.id,
        name: "phase6.2-fee-immutability (ephemeral)",
        params: { productId: "SOL-USDC", amountPerBuy: 10, interval: "daily", durationDays: 1 },
      },
    });

    const sessionIds: number[] = [];
    try {
      const sessionA = await createSession({
        mode: "PAPER",
        strategyConfigId: strategyConfig.id,
        productId: "SOL-USDC",
        initialQuoteBalance: 1000,
        initialBaseBalance: 0,
      });
      sessionIds.push(sessionA.id);
      expect(sessionA.feeSchedule).toEqual({ makerRate: 0.006, takerRate: 0.012 });

      // Simulate the account's real Coinbase volume tier changing (a fee-schedule constant edit) —
      // this must NOT retroactively alter session A's already-stored rate.
      DEFAULT_FEE_SCHEDULE.makerRate = 0.001;
      DEFAULT_FEE_SCHEDULE.takerRate = 0.002;

      const sessionAReloaded = await prisma.session.findUniqueOrThrow({ where: { id: sessionA.id } });
      expect(sessionAReloaded.feeSchedule).toEqual({ makerRate: 0.006, takerRate: 0.012 });

      // A NEW session created after the change correctly picks up the new default — only
      // retroactively altering an EXISTING session's stored rate is what's guarded against.
      const sessionB = await createSession({
        mode: "PAPER",
        strategyConfigId: strategyConfig.id,
        productId: "SOL-USDC",
        initialQuoteBalance: 1000,
        initialBaseBalance: 0,
      });
      sessionIds.push(sessionB.id);
      expect(sessionB.feeSchedule).toEqual({ makerRate: 0.001, takerRate: 0.002 });

      // Session A must still be untouched even after a second session was created under the new default.
      const sessionAFinal = await prisma.session.findUniqueOrThrow({ where: { id: sessionA.id } });
      expect(sessionAFinal.feeSchedule).toEqual({ makerRate: 0.006, takerRate: 0.012 });
    } finally {
      for (const id of sessionIds) {
        await prisma.session.delete({ where: { id } }).catch(() => {});
      }
      await prisma.strategyConfig.delete({ where: { id: strategyConfig.id } });
    }
  });
});
