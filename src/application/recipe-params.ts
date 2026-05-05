import type { RecipeParam } from "./recipes-loader";

/**
 * One bound parameter value. `null` is internal-only — callers may not pass
 * `null` directly; the resolver assigns it for declared optional params that
 * the caller omitted, so positional `?` placeholders stay aligned with the
 * declaration order in the recipe.
 */
export type RecipeParamValue = string | number | boolean | null;

/** Loose `key: value` map of params provided to a recipe by the caller. */
export type RecipeParamValues = Record<string, RecipeParamValue>;

/** Successful resolution; `values` are positional in declaration order. */
export interface ResolveRecipeParamsOk {
  ok: true;
  values: RecipeParamValue[];
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
  return { ...(base ?? {}), ...next };
}

/**
 * Validate `provided` against `declared` and produce positional bind values
 * in declaration order. Strict on missing required, unknown keys, and type
 * mismatches; coerces `string | number` into the declared `number` /
 * `boolean` types where the value is unambiguous.
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

  const values: RecipeParamValue[] = [];
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
  | { ok: true; value: Exclude<RecipeParamValue, null> }
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
    return { ok: true, value: n };
  }
  if (typeof raw === "boolean") return { ok: true, value: raw };
  // Accept numeric `1`/`0` as well as their string forms — MCP / HTTP callers
  // hit this path because `query_recipe.params` accepts `z.number()` and the
  // CLI / HTTP layers don't pre-coerce numeric booleans.
  if (raw === "true" || raw === "1" || raw === 1) {
    return { ok: true, value: true };
  }
  if (raw === "false" || raw === "0" || raw === 0) {
    return { ok: true, value: false };
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
