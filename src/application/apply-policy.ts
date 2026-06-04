import { getQueryRecipeActions } from "./query-recipes";

/**
 * Step 4 — `auto_fixable` gates writes unless `--force`.
 * Recipes with no `actions` block require `--force` (no implicit opt-in).
 */
export function assertApplyAutoFixable(opts: {
  recipeId: string;
  force: boolean;
}): string | undefined {
  if (opts.force) return undefined;
  const actions = getQueryRecipeActions(opts.recipeId);
  if (actions === undefined || actions.length === 0) {
    return `codemap apply: recipe "${opts.recipeId}" has no actions with auto_fixable: true. Pass --force to apply anyway.`;
  }
  const fixable = actions.some((a) => a.auto_fixable === true);
  if (!fixable) {
    return `codemap apply: recipe "${opts.recipeId}" is not auto_fixable. Pass --force to apply anyway.`;
  }
  return undefined;
}

/** Step 12 — when `apply.autoApplyRecipes` is set, `--yes` alone is insufficient. */
export function assertApplyAllowlist(opts: {
  recipeId: string;
  yes: boolean;
  force: boolean;
  allowlist: readonly string[] | undefined;
}): string | undefined {
  const list = opts.allowlist;
  if (list === undefined || list.length === 0) return undefined;
  if (opts.force || !opts.yes) return undefined;
  if (list.includes(opts.recipeId)) return undefined;
  return `codemap apply: recipe "${opts.recipeId}" is not in apply.autoApplyRecipes. Add it to config or pass --force.`;
}
