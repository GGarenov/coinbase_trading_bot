import type { JsonSchemaNode, PathSegment } from "@/lib/jsonSchemaForm";
import { defaultForSchema } from "@/lib/jsonSchemaForm";
import { titleCase } from "@/lib/format";
import { inputClass, labelClass } from "./Input";

/** A stable, unique id/name for a field from its path (e.g. ["levels", 0, "price"] -> "params-levels-0-price") — every input needs one so autofill/a11y tooling can address it, and so two array items' same-named fields (e.g. two levels' "price") don't collide. */
function fieldId(path: PathSegment[]): string {
  return ["params", ...path].join("-");
}

export interface SchemaFieldProps {
  schema: JsonSchemaNode;
  value: unknown;
  path: PathSegment[];
  label: string;
  onSet: (path: PathSegment[], value: unknown) => void;
  onAddItem: (path: PathSegment[], item: unknown) => void;
  onRemoveItem: (path: PathSegment[], index: number) => void;
}

/** Recursive JSON-Schema-driven field renderer — see `lib/jsonSchemaForm.ts`'s doc comment for scope. */
export function SchemaField({ schema, value, path, label, onSet, onAddItem, onRemoveItem }: SchemaFieldProps) {
  if (schema.type === "object") {
    return (
      <fieldset className="space-y-3 rounded-lg border border-border p-4">
        <legend className="px-1 text-base font-medium">{titleCase(label)}</legend>
        {Object.entries(schema.properties ?? {}).map(([key, sub]) => (
          <SchemaField
            key={key}
            schema={sub}
            value={(value as Record<string, unknown> | undefined)?.[key]}
            path={[...path, key]}
            label={key}
            onSet={onSet}
            onAddItem={onAddItem}
            onRemoveItem={onRemoveItem}
          />
        ))}
      </fieldset>
    );
  }

  if (schema.type === "array") {
    const items = Array.isArray(value) ? value : [];
    return (
      <div>
        <span className={labelClass}>{titleCase(label)}</span>
        <div className="mt-2 space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                {schema.items && (
                  <SchemaField
                    schema={schema.items}
                    value={item}
                    path={[...path, i]}
                    label={`${label} #${i + 1}`}
                    onSet={onSet}
                    onAddItem={onAddItem}
                    onRemoveItem={onRemoveItem}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => onRemoveItem(path, i)}
                className="mt-1 shrink-0 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted hover:border-red-800 hover:text-red-400"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => schema.items && onAddItem(path, defaultForSchema(schema.items))}
          className="mt-2 rounded-md border border-dashed border-border px-3 py-1.5 text-sm text-muted hover:border-accent/60 hover:text-foreground"
        >
          + Add {titleCase(label).replace(/s$/, "")}
        </button>
      </div>
    );
  }

  const id = fieldId(path);

  if (schema.type === "boolean") {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-base">
        <input id={id} name={id} type="checkbox" checked={Boolean(value)} onChange={(e) => onSet(path, e.target.checked)} />
        {titleCase(label)}
      </label>
    );
  }

  if (schema.enum) {
    return (
      <label htmlFor={id} className="block">
        <span className={labelClass}>{titleCase(label)}</span>
        <select id={id} name={id} className={`${inputClass} mt-1`} value={(value as string) ?? ""} onChange={(e) => onSet(path, e.target.value)}>
          {schema.enum.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <label htmlFor={id} className="block">
        <span className={labelClass}>{titleCase(label)}</span>
        <input
          id={id}
          name={id}
          type="number"
          step={schema.type === "integer" ? 1 : "any"}
          min={schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum : undefined)}
          max={schema.maximum}
          className={`${inputClass} mt-1`}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => onSet(path, e.target.value === "" ? undefined : Number(e.target.value))}
        />
      </label>
    );
  }

  // string (default case)
  return (
    <label htmlFor={id} className="block">
      <span className={labelClass}>{titleCase(label)}</span>
      <input id={id} name={id} type="text" className={`${inputClass} mt-1`} value={(value as string) ?? ""} onChange={(e) => onSet(path, e.target.value)} />
    </label>
  );
}
