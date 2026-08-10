import {
  getQueryRecipeParams,
  getQueryRecipeSql,
} from "../../src/application/query-recipes";
import { resolveRecipeParams } from "../../src/application/recipe-params";
import type { ResolvedRecipeParamValue } from "../../src/application/recipe-params";
import type { GoldenScenario } from "./schema";

export function resolveGoldenQuery(s: GoldenScenario): {
  sql: string;
  bindValues: ResolvedRecipeParamValue[];
} {
  if (s.sql !== undefined) {
    if (s.params !== undefined) {
      throw new Error(
        `Scenario "${s.id}": params are only supported with recipe-based scenarios; raw SQL scenarios must not declare params.`,
      );
    }
    return { sql: s.sql, bindValues: [] };
  }
  if (s.recipe !== undefined) {
    const sql = getQueryRecipeSql(s.recipe);
    if (sql === undefined) {
      throw new Error(`Scenario "${s.id}": unknown recipe "${s.recipe}"`);
    }
    const resolved = resolveRecipeParams({
      recipeId: s.recipe,
      declared: getQueryRecipeParams(s.recipe),
      provided: s.params,
    });
    if (!resolved.ok) {
      throw new Error(`Scenario "${s.id}": ${resolved.error}`);
    }
    return { sql, bindValues: resolved.values };
  }
  throw new Error(`Scenario "${s.id}": missing sql or recipe`);
}
