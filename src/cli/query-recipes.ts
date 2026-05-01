import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAllRecipes } from "../application/recipes-loader";
import type { LoadedRecipe } from "../application/recipes-loader";

export type { RecipeAction } from "../application/recipes-loader";
import type { RecipeAction } from "../application/recipes-loader";

/**
 * One bundled recipe: id, human description, SQL, and optional per-row actions
 * (canonical source for CLI, `--recipes-json`, and the JSON output enrichment).
 *
 * NOTE: Kept for backwards-compat with callers that destructure the legacy
 * shape. `LoadedRecipe` (from `application/recipes-loader`) is the new
 * canonical type — has `body`, `source`, `shadows` in addition.
 */
export interface QueryRecipeCatalogEntry {
  id: string;
  description: string;
  sql: string;
  actions?: RecipeAction[];
}

/**
 * Directory containing the bundled recipe `.sql` + `.md` files (next to
 * `dist/` and `templates/agents/` in the published npm artifact). Mirrors
 * `resolveAgentsTemplateDir()`'s layout — see [`docs/architecture.md`
 * § Recipes wiring].
 */
export function resolveBundledRecipesDir(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "templates",
    "recipes",
  );
}

/**
 * Bundled recipe `actions` templates. Per-row hint that surfaces in `--json`
 * output so agents see the recommended follow-up alongside each row. Lives
 * here in code through Tracer 2 → Tracer 5 will lift these into YAML
 * frontmatter on the sibling `<id>.md` and remove this map.
 *
 * Add an entry here only when the recipe has a concrete next step the agent
 * should consider for *every* row — counts-by-kind and similar aggregates
 * intentionally have no actions.
 */
const BUNDLED_RECIPE_ACTIONS: Record<string, RecipeAction[]> = {
  "fan-out": [
    {
      type: "review-coupling",
      description:
        "High fan-out usually means orchestrator role; consider extracting helpers or splitting responsibilities.",
    },
  ],
  "fan-in": [
    {
      type: "review-stability",
      description:
        "High fan-in: changes here ripple through many consumers. Protect with tests before refactoring.",
    },
  ],
  "files-largest": [
    {
      type: "split-file",
      description:
        "Files this large are typical refactor candidates. Look for cohesive sub-modules to extract.",
    },
  ],
  "deprecated-symbols": [
    {
      type: "flag-caller",
      description:
        "Warn before suggesting changes that depend on this symbol; check callers via the calls table.",
    },
  ],
  "visibility-tags": [
    {
      type: "flag-non-public",
      description:
        "Treat as not part of the public API unless visibility = 'public': don't import from package consumers; check the visibility tag before extending re-exports.",
    },
  ],
  "barrel-files": [
    {
      type: "split-barrel",
      description:
        "Confirm this is an intentional public-API surface; if it's accidental fan-out, consider splitting into smaller barrels.",
    },
  ],
};

/**
 * Module-cached registry — populated lazily on first access (loader is pure;
 * the cache means we pay the filesystem read once per process lifetime per
 * plan §9 Q-B). Project recipes (Tracer 3) will wire `projectDir` here once
 * the bootstrap layer can pass it in.
 */
let cachedRegistry: LoadedRecipe[] | undefined;

function getRegistry(): LoadedRecipe[] {
  if (cachedRegistry === undefined) {
    cachedRegistry = loadAllRecipes({
      bundledDir: resolveBundledRecipesDir(),
      projectDir: undefined,
    }).map((r) => ({
      ...r,
      // Stitch in the bundled actions map until Tracer 5 lifts them into
      // frontmatter on each `.md` file.
      actions:
        r.source === "bundled" ? BUNDLED_RECIPE_ACTIONS[r.id] : r.actions,
    }));
  }
  return cachedRegistry;
}

/**
 * Reset the module cache — test-only escape hatch for fixture swaps.
 */
export function _resetRecipesCacheForTests(): void {
  cachedRegistry = undefined;
}

/**
 * Bundled read-only SQL for `codemap query --recipe <id>`. Backwards-compat
 * shim — derives from the registry; new callers should use the loader's
 * {@link LoadedRecipe} shape via `listQueryRecipeCatalog()` (richer fields:
 * `body`, `source`, `shadows`).
 */
export const QUERY_RECIPES: Record<
  string,
  { sql: string; description: string; actions?: RecipeAction[] }
> = new Proxy(
  {},
  {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const recipe = getRegistry().find((r) => r.id === prop);
      if (recipe === undefined) return undefined;
      return {
        sql: recipe.sql,
        description: recipe.description ?? recipe.id,
        ...(recipe.actions !== undefined ? { actions: recipe.actions } : {}),
      };
    },
    ownKeys() {
      return getRegistry().map((r) => r.id);
    },
    getOwnPropertyDescriptor(_target, prop) {
      if (typeof prop !== "string") return undefined;
      const recipe = getRegistry().find((r) => r.id === prop);
      if (recipe === undefined) return undefined;
      return {
        enumerable: true,
        configurable: true,
        value: {
          sql: recipe.sql,
          description: recipe.description ?? recipe.id,
          ...(recipe.actions !== undefined ? { actions: recipe.actions } : {}),
        },
      };
    },
  },
);

/**
 * Sorted recipe ids (same set as {@link QUERY_RECIPES}).
 */
export function listQueryRecipeIds(): string[] {
  return getRegistry().map((r) => r.id);
}

/**
 * Full catalog for **`codemap query --recipes-json`**.
 *
 * Tracer 2 returns the legacy shape (id / description / sql / actions?).
 * Tracer 4 will extend the catalog payload to include `body`, `source`,
 * and `shadows` from the {@link LoadedRecipe} shape.
 */
export function listQueryRecipeCatalog(): QueryRecipeCatalogEntry[] {
  return getRegistry().map((r) => {
    const entry: QueryRecipeCatalogEntry = {
      id: r.id,
      description: r.description ?? r.id,
      sql: r.sql,
    };
    if (r.actions !== undefined) entry.actions = r.actions;
    return entry;
  });
}

/**
 * Returns the SQL string for a recipe id, or `undefined` if unknown.
 */
export function getQueryRecipeSql(id: string): string | undefined {
  return getRegistry().find((r) => r.id === id)?.sql;
}

/**
 * Returns the per-row {@link RecipeAction} template for a recipe id, or
 * `undefined` if the recipe is unknown OR carries no actions. Recipe-only:
 * ad-hoc SQL never gets actions.
 */
export function getQueryRecipeActions(id: string): RecipeAction[] | undefined {
  return getRegistry().find((r) => r.id === id)?.actions;
}
