import type { FeeSchedule } from "@coinbase-trading-bot/shared";
import { DEFAULT_FEE_SCHEDULE } from "@coinbase-trading-bot/shared";
import { prisma } from "@coinbase-trading-bot/shared/server";

type SessionMode = "BACKTEST" | "PAPER" | "LIVE";

export interface CreateSessionParams {
  mode: SessionMode;
  strategyConfigId: number;
  productId: string;
  initialQuoteBalance: number;
  initialBaseBalance: number;
  /** Backtest window bounds — required for BACKTEST, unused for PAPER/LIVE. */
  startDate?: Date;
  endDate?: Date;
  /**
   * Overrides the default maker/taker rates — e.g. once the account's real
   * Coinbase volume tier moves off the lowest bracket `DEFAULT_FEE_SCHEDULE`
   * assumes. Defaults to `DEFAULT_FEE_SCHEDULE` when omitted.
   */
  feeScheduleOverride?: FeeSchedule;
  /**
   * Live-Trading Safety Rails: caps enforced by `liveSafetyGuard.ts`, only
   * for `mode: "LIVE"` sessions. Omitted/undefined = no cap. Strongly
   * recommended to set both before ever creating a LIVE session — there is
   * no other place in this codebase that limits real spend or position size.
   */
  maxSpendPerOrder?: number;
  maxPositionSize?: number;
}

/**
 * The single place a `Session` row gets created, so `feeSchedule` is always
 * snapshotted at creation time — from a fixed default, or an explicit
 * override — and never re-read live from a mutable config afterward
 * (a later change to the default doesn't retroactively alter an
 * already-created session's fees).
 *
 * This is also this pass's stand-in for the not-yet-built `POST /sessions`
 * HTTP route (routes don't exist yet — see Continuous Operation/dashboard
 * work): `feeScheduleOverride` IS the "way for the user to override
 * maker/taker rates" the Fee Model task list asks for. Once a real route
 * exists, it's a one-line change — forward a request-body field into this
 * same parameter — not a new mechanism.
 */
export async function createSession(params: CreateSessionParams) {
  return prisma.session.create({
    data: {
      mode: params.mode,
      strategyConfigId: params.strategyConfigId,
      productId: params.productId,
      initialQuoteBalance: params.initialQuoteBalance,
      initialBaseBalance: params.initialBaseBalance,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- FeeSchedule is a plain {makerRate,takerRate} object; Prisma's generated Json input type just doesn't structurally recognize it
      feeSchedule: (params.feeScheduleOverride ?? DEFAULT_FEE_SCHEDULE) as any,
      startDate: params.startDate,
      endDate: params.endDate,
      maxSpendPerOrder: params.maxSpendPerOrder,
      maxPositionSize: params.maxPositionSize,
    },
  });
}
