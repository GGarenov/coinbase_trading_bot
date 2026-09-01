import { prisma } from "@coinbase-trading-bot/shared/server";

export const OUT_OF_SAMPLE_RECOMMENDATION =
  "Before trusting this result, re-run the same parameters over a different historical " +
  "period they weren't tuned on (out-of-sample). A config that only looks good on one " +
  "specific window may just be curve-fit to that window's particular price action.";

/**
 * Flags when other BACKTEST sessions already ran the SAME strategy, over
 * the SAME product and EXACT historical window, with DIFFERENT parameters
 * (a different `strategyConfigId`) — the classic sign of "keep tweaking
 * parameters against one fixed window until something looks good," which
 * risks curve-fitting to that window's specific price action rather than
 * finding a genuinely robust configuration.
 */
export async function checkCurveFittingRisk(params: {
  strategyId: number;
  productId: string;
  startDate: Date;
  endDate: Date;
  excludeSessionId: number;
  excludeStrategyConfigId: number;
}): Promise<string | null> {
  const priorRuns = await prisma.session.count({
    where: {
      mode: "BACKTEST",
      productId: params.productId,
      startDate: params.startDate,
      endDate: params.endDate,
      id: { not: params.excludeSessionId },
      strategyConfigId: { not: params.excludeStrategyConfigId },
      strategyConfig: { strategyId: params.strategyId },
    },
  });

  if (priorRuns === 0) return null;

  return (
    `${priorRuns} other backtest(s) already ran this same strategy over this exact ` +
    `${params.productId} window (${params.startDate.toISOString()} .. ${params.endDate.toISOString()}) ` +
    `with different parameters — possible curve-fitting risk. ${OUT_OF_SAMPLE_RECOMMENDATION}`
  );
}
