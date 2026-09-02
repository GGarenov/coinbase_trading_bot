/**
 * A small, purpose-built JSON Schema subset for rendering a strategy's
 * config form (Phase 4.2) — handles exactly what the engine's 4 strategies
 * actually emit from `z.toJSONSchema()` (string/number/integer/boolean,
 * `enum`, nested `object`, and `array` of `object` — see
 * `routes/strategies.ts`'s doc comment and a real `GET /strategies`
 * response for the ground truth). Deliberately NOT a general-purpose JSON
 * Schema library — no `oneOf`/`anyOf`/`$ref`/tuple support, since nothing
 * in this project's strategy catalog needs it. If a future strategy's
 * schema needs a shape this doesn't handle, extend this file then, not
 * speculatively now.
 */

export type PathSegment = string | number;

export interface JsonSchemaNode {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  enum?: string[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  minItems?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  minLength?: number;
  default?: unknown;
}

/** Immutable set at an arbitrary path through a mix of plain objects and arrays. */
export function setAtPath(target: unknown, path: PathSegment[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === "number") {
    const arr = Array.isArray(target) ? [...target] : [];
    arr[head] = setAtPath(arr[head], rest, value);
    return arr;
  }
  const obj = typeof target === "object" && target !== null && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  obj[head] = setAtPath(obj[head], rest, value);
  return obj;
}

export function getAtPath(target: unknown, path: PathSegment[]): unknown {
  let current = target;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<PathSegment, unknown>)[segment];
  }
  return current;
}

/** A reasonable blank value for a schema node — used when adding a new array item (e.g. a new grid level). */
export function defaultForSchema(schema: JsonSchemaNode): unknown {
  if (schema.default !== undefined) return schema.default;
  switch (schema.type) {
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(schema.properties ?? {})) obj[key] = defaultForSchema(sub);
      return obj;
    }
    case "array":
      return [];
    case "boolean":
      return false;
    case "number":
    case "integer":
      return schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : (schema.minimum ?? 0);
    case "string":
      return schema.enum?.[0] ?? "";
    default:
      return "";
  }
}

/**
 * Validates a value against a schema node, returning human-readable error
 * messages (empty array = valid). Mirrors the exact constraint keywords
 * Zod 4's `z.toJSONSchema()` actually emits for this project's strategies
 * (`required`, `minLength`, `minimum`/`maximum`/`exclusiveMinimum`,
 * `minItems`, `enum`) — this is pre-submit UX feedback only, not the
 * source of truth; `POST /configs` re-validates against the real Zod
 * schema server-side regardless, so a gap here fails safe, not silently.
 */
export function validateAgainstSchema(schema: JsonSchemaNode, value: unknown, label: string): string[] {
  const errors: string[] = [];

  if (schema.type === "object") {
    // No separate blanket "required" pass here — each property's own validator below already
    // reports a missing/empty value appropriately for its type (e.g. a required string reports via
    // its own minLength check, a required number via "must be a number"), so doing both would just
    // duplicate the same message.
    const obj = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      errors.push(...validateAgainstSchema(sub, obj[key], key));
    }
    return errors;
  }

  if (schema.type === "array") {
    const arr = Array.isArray(value) ? value : [];
    if (schema.minItems !== undefined && arr.length < schema.minItems) {
      errors.push(`${label} needs at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}`);
    }
    arr.forEach((item, i) => {
      if (schema.items) errors.push(...validateAgainstSchema(schema.items, item, `${label} #${i + 1}`).map((e) => `${label} #${i + 1}: ${e}`));
    });
    return errors;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      errors.push(`${label} must be a number`);
      return errors;
    }
    if (schema.type === "integer" && !Number.isInteger(value)) errors.push(`${label} must be a whole number`);
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${label} must be ≥ ${schema.minimum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${label} must be greater than ${schema.exclusiveMinimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${label} must be ≤ ${schema.maximum}`);
    return errors;
  }

  if (schema.type === "string") {
    if (schema.enum && !schema.enum.includes(value as string)) errors.push(`${label} must be one of ${schema.enum.join(", ")}`);
    else if (schema.minLength !== undefined && (typeof value !== "string" || value.length < schema.minLength)) errors.push(`${label} is required`);
    return errors;
  }

  return errors;
}
