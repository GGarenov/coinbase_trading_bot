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
import { Button } from "./Button";
import { Card } from "./Card";
import { inputClass, labelClass } from "./Input";
import { SchemaField } from "./SchemaField";

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
      <p className="text-base text-red-400">
        This strategy has no params schema on record — its catalog row doesn&apos;t match a registered strategy implementation.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <SchemaField schema={schema} value={params} path={[]} label="Parameters" onSet={setParam} onAddItem={addParamItem} onRemoveItem={removeParamItem} />

      {paramErrors.length > 0 && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-base text-red-400">
          <p className="font-medium">Fix the following before continuing:</p>
          <ul className="mt-1 list-inside list-disc">
            {paramErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <Card>
        <h2 className="text-lg font-medium">Session setup</h2>
        <p className="mt-1 text-base text-muted">Starting balances for a backtest, paper, or live session.</p>
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
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Backtest</h2>
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
        <Button type="button" disabled={busy} onClick={() => runAction("backtest")} className="mt-4">
          {actionState.kind === "busy" && actionState.action === "backtest" ? "Running backtest…" : "Launch backtest"}
        </Button>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Paper session</h2>
        <p className="mt-1 text-base text-muted">Simulated fills against live Coinbase prices — no real orders.</p>
        <Button type="button" disabled={busy} onClick={() => runAction("paper")} className="mt-4">
          {actionState.kind === "busy" && actionState.action === "paper" ? "Starting…" : "Start paper session"}
        </Button>
      </Card>

      <Card className="border-red-900/50">
        <h2 className="text-lg font-medium text-red-400">Live session</h2>
        <p className="mt-1 text-base text-muted">
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
        <label htmlFor="liveConfirmed" className="mt-3 flex items-start gap-2 text-base">
          <input id="liveConfirmed" name="liveConfirmed" type="checkbox" className="mt-1" checked={liveConfirmed} onChange={(e) => setLiveConfirmed(e.target.checked)} />
          I understand this will place real orders with real funds.
        </label>
        <Button type="button" variant="danger" disabled={busy || !liveConfirmed} onClick={() => runAction("live")} className="mt-4">
          {actionState.kind === "busy" && actionState.action === "live" ? "Starting…" : "Start live session"}
        </Button>
      </Card>

      {actionState.kind === "error" && (
        <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-base text-red-400">{actionState.message}</div>
      )}
    </div>
  );
}
