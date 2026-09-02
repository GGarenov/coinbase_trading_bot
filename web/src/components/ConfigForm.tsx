"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createBacktest,
  createSession,
  createStrategyConfig,
  type StrategyCatalogEntry,
} from "@/lib/api";
import { describeError } from "@/lib/describeError";
import type { JsonSchemaNode, PathSegment } from "@/lib/jsonSchemaForm";
import { getAtPath, setAtPath, validateAgainstSchema } from "@/lib/jsonSchemaForm";
import { SchemaField } from "./SchemaField";

const inputClass =
  "w-full rounded-md border border-black/10 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/40";
const labelClass = "block text-sm font-medium text-zinc-700 dark:text-zinc-300";
const cardClass = "rounded-lg border border-black/10 p-5 dark:border-white/10";

type ActionState = { kind: "idle" } | { kind: "busy"; action: string } | { kind: "error"; message: string };

function todayIso(daysAgo = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

export function ConfigForm({ strategy }: { strategy: StrategyCatalogEntry }) {
  const router = useRouter();
  const schema = strategy.paramsSchema as JsonSchemaNode | null;

  const [params, setParams] = useState<Record<string, unknown>>((strategy.defaultParams as Record<string, unknown>) ?? {});
  const [initialQuoteBalance, setInitialQuoteBalance] = useState(1000);
  const [initialBaseBalance, setInitialBaseBalance] = useState(0);
  const [startDate, setStartDate] = useState(todayIso(30));
  const [endDate, setEndDate] = useState(todayIso(0));
  const [maxSpendPerOrder, setMaxSpendPerOrder] = useState("");
  const [maxPositionSize, setMaxPositionSize] = useState("");
  const [liveConfirmed, setLiveConfirmed] = useState(false);
  const [paramErrors, setParamErrors] = useState<string[]>([]);
  const [actionState, setActionState] = useState<ActionState>({ kind: "idle" });

  function setParam(path: PathSegment[], value: unknown) {
    setParams((prev) => setAtPath(prev, path, value) as Record<string, unknown>);
  }
  function addParamItem(path: PathSegment[], item: unknown) {
    setParams((prev) => {
      const arr = getAtPath(prev, path);
      return setAtPath(prev, path, [...(Array.isArray(arr) ? arr : []), item]) as Record<string, unknown>;
    });
  }
  function removeParamItem(path: PathSegment[], index: number) {
    setParams((prev) => {
      const arr = getAtPath(prev, path);
      return setAtPath(prev, path, (Array.isArray(arr) ? arr : []).filter((_, i) => i !== index)) as Record<string, unknown>;
    });
  }

  async function runAction(action: "backtest" | "paper" | "live") {
    if (!schema) return;
    const errors = validateAgainstSchema(schema, params, "Parameters");
    setParamErrors(errors);
    if (errors.length > 0) return;

    setActionState({ kind: "busy", action });
    try {
      const config = await createStrategyConfig({ strategySlug: strategy.slug, params });
      const productId = String(params.productId ?? "");

      if (action === "backtest") {
        const result = await createBacktest({
          strategyConfigId: config.id,
          productId,
          startDate: new Date(startDate).toISOString(),
          endDate: new Date(endDate).toISOString(),
          initialQuoteBalance,
          initialBaseBalance,
        });
        router.push(`/backtests/${result.sessionId}`);
        return;
      }

      const result = await createSession({
        strategyConfigId: config.id,
        productId,
        mode: action === "paper" ? "PAPER" : "LIVE",
        initialQuoteBalance,
        initialBaseBalance,
        ...(action === "live"
          ? {
              maxSpendPerOrder: maxSpendPerOrder === "" ? undefined : Number(maxSpendPerOrder),
              maxPositionSize: maxPositionSize === "" ? undefined : Number(maxPositionSize),
            }
          : {}),
      });
      router.push(`/sessions/${result.sessionId}`);
    } catch (err) {
      setActionState({ kind: "error", message: describeError(err) });
      return;
    }
    setActionState({ kind: "idle" });
  }

  const busy = actionState.kind === "busy";

  if (!schema) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        This strategy has no params schema on record — its catalog row doesn&apos;t match a registered strategy implementation.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <SchemaField schema={schema} value={params} path={[]} label="Parameters" onSet={setParam} onAddItem={addParamItem} onRemoveItem={removeParamItem} />

      {paramErrors.length > 0 && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          <p className="font-medium">Fix the following before continuing:</p>
          <ul className="mt-1 list-inside list-disc">
            {paramErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <div className={cardClass}>
        <h2 className="font-medium">Session setup</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Starting balances for a backtest, paper, or live session.</p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="initialQuoteBalance" className="block">
            <span className={labelClass}>Initial quote balance</span>
            <input id="initialQuoteBalance" name="initialQuoteBalance" type="number" min={0} className={`${inputClass} mt-1`} value={initialQuoteBalance} onChange={(e) => setInitialQuoteBalance(Number(e.target.value))} />
          </label>
          <label htmlFor="initialBaseBalance" className="block">
            <span className={labelClass}>Initial base balance</span>
            <input id="initialBaseBalance" name="initialBaseBalance" type="number" min={0} className={`${inputClass} mt-1`} value={initialBaseBalance} onChange={(e) => setInitialBaseBalance(Number(e.target.value))} />
          </label>
        </div>
      </div>

      <div className={cardClass}>
        <h2 className="font-medium">Backtest</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="startDate" className="block">
            <span className={labelClass}>Start date</span>
            <input id="startDate" name="startDate" type="date" className={`${inputClass} mt-1`} value={startDate} onChange={(e) => setStartDate(e.target.value)} max={endDate} />
          </label>
          <label htmlFor="endDate" className="block">
            <span className={labelClass}>End date</span>
            <input id="endDate" name="endDate" type="date" className={`${inputClass} mt-1`} value={endDate} onChange={(e) => setEndDate(e.target.value)} max={todayIso(0)} />
          </label>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => runAction("backtest")}
          className="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {actionState.kind === "busy" && actionState.action === "backtest" ? "Running backtest…" : "Launch backtest"}
        </button>
      </div>

      <div className={cardClass}>
        <h2 className="font-medium">Paper session</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Simulated fills against live Coinbase prices — no real orders.</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => runAction("paper")}
          className="mt-4 rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {actionState.kind === "busy" && actionState.action === "paper" ? "Starting…" : "Start paper session"}
        </button>
      </div>

      <div className={`${cardClass} border-red-200 dark:border-red-900/50`}>
        <h2 className="font-medium text-red-700 dark:text-red-400">Live session</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Places REAL orders with REAL funds. Blocked server-side unless the engine has `LIVE_TRADING_ENABLED=true` and the kill switch is off — see
          `docs/live-safety-test-plan.md`.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label htmlFor="maxSpendPerOrder" className="block">
            <span className={labelClass}>Max spend per order (optional, strongly recommended)</span>
            <input id="maxSpendPerOrder" name="maxSpendPerOrder" type="number" min={0} className={`${inputClass} mt-1`} value={maxSpendPerOrder} onChange={(e) => setMaxSpendPerOrder(e.target.value)} />
          </label>
          <label htmlFor="maxPositionSize" className="block">
            <span className={labelClass}>Max position size (optional, strongly recommended)</span>
            <input id="maxPositionSize" name="maxPositionSize" type="number" min={0} className={`${inputClass} mt-1`} value={maxPositionSize} onChange={(e) => setMaxPositionSize(e.target.value)} />
          </label>
        </div>
        <label htmlFor="liveConfirmed" className="mt-3 flex items-start gap-2 text-sm">
          <input id="liveConfirmed" name="liveConfirmed" type="checkbox" className="mt-0.5" checked={liveConfirmed} onChange={(e) => setLiveConfirmed(e.target.checked)} />
          I understand this will place real orders with real funds.
        </label>
        <button
          type="button"
          disabled={busy || !liveConfirmed}
          onClick={() => runAction("live")}
          className="mt-4 rounded-full bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50"
        >
          {actionState.kind === "busy" && actionState.action === "live" ? "Starting…" : "Start live session"}
        </button>
      </div>

      {actionState.kind === "error" && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400">
          {actionState.message}
        </div>
      )}
    </div>
  );
}
