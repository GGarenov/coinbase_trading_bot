import { prisma } from "@coinbase-trading-bot/shared";

/**
 * A single-row DB flag (`SystemSetting`, id always 1) — the global
 * live-trading kill switch. Deliberately a DB flag, not an env var: an env
 * var is fixed when the engine process starts, so it can't halt an
 * already-running LIVE session without a restart; this can, since it's
 * checked fresh on every tick (see `liveSafetyGuard.ts`).
 */
const SETTINGS_ID = 1;

export async function isKillSwitchEngaged(): Promise<boolean> {
  const setting = await prisma.systemSetting.findUnique({ where: { id: SETTINGS_ID } });
  return setting?.liveTradingKillSwitch ?? false;
}

/** Engages or releases the kill switch. Intended for an operator to call manually — no route exists for this yet (no dashboard/API surface asked for it). */
export async function setKillSwitch(engaged: boolean): Promise<void> {
  await prisma.systemSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { liveTradingKillSwitch: engaged },
    create: { id: SETTINGS_ID, liveTradingKillSwitch: engaged },
  });
}
