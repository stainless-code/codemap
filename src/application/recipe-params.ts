import type { RecipeParam } from "./recipes-loader";

/** Map positional bind values back to param names for action command templates. */
export function recipeParamValuesFromResolved(
  declared: RecipeParam[] | undefined,
  values: ResolvedRecipeParamValue[],
): RecipeParamValues {
  const out: RecipeParamValues = {};
  for (let i = 0; i < (declared ?? []).length; i++) {
    const param = declared![i]!;
    const value = values[i];
    if (value !== null && value !== undefined) out[param.name] = value;
  }
  return out;
}

/**
 * One parameter value from a caller. May include JS `boolean` for
 * `type: "boolean"` params; {@link resolveRecipeParams} coerces those to
 * SQLite-safe `1` / `0` in {@link ResolvedRecipeParamValue}. `null` is
 * internal-only on the resolved list — callers may not pass `null` directly;
 * the resolver assigns it for declared optional params that the caller
 * omitted, so positional `?` placeholders stay aligned with declaration order.
 */
export type RecipeParamValue = string | number | boolean | null;

/**
 * Bind-ready value after {@link resolveRecipeParams} — never JS `boolean`
 * (better-sqlite3 rejects them). Assignable to `QueryBindValue`.
 */
export type ResolvedRecipeParamValue = string | number | null;

/** Loose `key: value` map of params provided to a recipe by the caller. */
export type RecipeParamValues = Record<string, RecipeParamValue>;

/** Successful resolution; `values` are positional in declaration order. */
export interface ResolveRecipeParamsOk {
  ok: true;
  values: ResolvedRecipeParamValue[];
}

/** Resolution failure; `error` carries a single human-readable message. */
export interface ResolveRecipeParamsError {
  ok: false;
  error: string;
}

/**
 * Parse the CLI `--params <k=v[,k=v]>` value into a {@link RecipeParamValues}
 * map. Splits on the first `=` so values may contain `=`; values may be
 * empty strings; comma-only fragments are skipped.
 */
export function parseParamsCli(value: string): RecipeParamValues {
  const out: RecipeParamValues = {};
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    const key = eq === -1 ? part : part.slice(0, eq);
    const rawValue = eq === -1 ? "" : part.slice(eq + 1);
    if (key.length === 0) continue;
    out[key] = rawValue;
  }
  return out;
}

/**
 * Merge two parameter maps with last-write-wins semantics on duplicate keys.
 * Used by the CLI parser to honour repeated `--params` flags.
 */
export function mergeParams(
  base: RecipeParamValues | undefined,
  next: RecipeParamValues,
): RecipeParamValues {
  return { ...base, ...next };
}

/**
 * Validate `provided` against `declared` and produce positional bind values
 * in declaration order. Strict on missing required, unknown keys, and type
 * mismatches; coerces `string | number` into the declared `number` type and
 * `boolean` / `true`/`false` / `1`/`0` into INTEGER `1` / `0` (better-sqlite3
 * rejects JS booleans at bind time; recipe SQL compares with `= 0` / `!= 0`).
 */
export function resolveRecipeParams(opts: {
  recipeId: string;
  declared: RecipeParam[] | undefined;
  provided: RecipeParamValues | undefined;
}): ResolveRecipeParamsOk | ResolveRecipeParamsError {
  const declared = opts.declared ?? [];
  const provided = opts.provided ?? {};
  if (declared.length === 0) {
    const keys = Object.keys(provided);
    if (keys.length === 0) return { ok: true, values: [] };
    return {
      ok: false,
      error: `${prefix(opts.recipeId)} unknown param "${keys[0]}". This recipe declares no params.`,
    };
  }

  const declaredByName = new Map(declared.map((p) => [p.name, p]));
  for (const key of Object.keys(provided)) {
    if (!declaredByName.has(key)) {
      return {
        ok: false,
        error: `${prefix(opts.recipeId)} unknown param "${key}". ${declaredParamsSummary(declared)}`,
      };
    }
  }

  const values: ResolvedRecipeParamValue[] = [];
  for (const param of declared) {
    const raw = provided[param.name];
    if (raw === undefined) {
      if (param.default !== undefined) {
        const coercedDefault = coerceParamValue(
          param,
          param.default,
          opts.recipeId,
        );
        if (!coercedDefault.ok) return coercedDefault;
        values.push(coercedDefault.value);
        continue;
      }
      if (param.required === true) {
        return {
          ok: false,
          error: `${prefix(opts.recipeId)} missing required param "${param.name}" (${param.type}). ${declaredParamsSummary(declared)}`,
        };
      }
      values.push(null);
      continue;
    }
    const coerced = coerceParamValue(param, raw, opts.recipeId);
    if (!coerced.ok) return coerced;
    values.push(coerced.value);
  }
  return { ok: true, values };
}

function coerceParamValue(
  param: RecipeParam,
  raw: RecipeParamValue,
  recipeId: string,
):
  | { ok: true; value: Exclude<ResolvedRecipeParamValue, null> }
  | ResolveRecipeParamsError {
  if (param.type === "string") {
    return { ok: true, value: String(raw) };
  }
  if (param.type === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      return {
        ok: false,
        error: `${prefix(recipeId)} --params ${param.name}="${String(raw)}" is not a number.`,
      };
    }
    if (!Number.isInteger(n)) {
      return {
        ok: false,
        error: `${prefix(recipeId)} --params ${param.name}="${String(raw)}" must be an integer.`,
      };
    }
    return { ok: true, value: n };
  }
  // Bind as INTEGER 0/1 — better-sqlite3 rejects JS booleans; recipe SQL
  // already uses `= 0` / `!= 0`. Accept numeric `1`/`0` and their string
  // forms — MCP / HTTP callers hit this path because `query_recipe.params`
  // accepts `z.number()` and the CLI / HTTP layers don't pre-coerce.
  if (typeof raw === "boolean") return { ok: true, value: raw ? 1 : 0 };
  if (raw === "true" || raw === "1" || raw === 1) {
    return { ok: true, value: 1 };
  }
  if (raw === "false" || raw === "0" || raw === 0) {
    return { ok: true, value: 0 };
  }
  return {
    ok: false,
    error: `${prefix(recipeId)} --params ${param.name}="${String(raw)}" is not a boolean (use true/false or 1/0).`,
  };
}

function declaredParamsSummary(params: RecipeParam[]): string {
  const rendered = params
    .map(
      (p) =>
        `${p.name} (${p.type}, ${p.required === true ? "required" : "optional"})`,
    )
    .join(", ");
  return `Declared params: ${rendered}.`;
}

function prefix(recipeId: string): string {
  return `codemap query --recipe ${recipeId}:`;
}
