import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getProjectRoot } from "../runtime";
import { loadAllRecipes } from "./recipes-loader";
import type { LoadedRecipe } from "./recipes-loader";

export type { RecipeAction, RecipeParam } from "./recipes-loader";
import type { RecipeAction, RecipeParam } from "./recipes-loader";

/**
 * Catalog entry surfaced to `--recipes-json`, the `codemap://recipes` MCP
 * resource, and the per-id `codemap://recipes/{id}` lookup. Backwards-compat
 * shape with three extensions added in Tracer 4:
 *
 * - **`body`** — full Markdown body of the sibling `<id>.md` (when present);
 *   description is the first non-empty line of that body.
 * - **`source`** — `"bundled"` (ships with the npm package) or `"project"`
 *   (loaded from `<projectRoot>/.codemap/recipes/`).
 * - **`shadows`** — `true` when a project recipe overrides a bundled recipe
 *   of the same id (per plan §9 Q-E — agents read this at session start to
 *   know when a recipe behaves differently from the documented bundled
 *   version). Absent / `false` for non-shadowing entries.
 * - **`params`** — declared recipe parameters in bind order, when the recipe
 *   is parametrised. Each entry carries `name` / `type` / `required` /
 *   `default` / `description`; the same shape `application/recipe-params.ts`
 *   validates against before SQL binding. Omitted on recipes that take no
 *   params.
 */
export interface QueryRecipeCatalogEntry {
  id: string;
  description: string;
  body?: string;
  sql: string;
  actions?: RecipeAction[];
  params?: RecipeParam[];
  source: "bundled" | "project";
  shadows?: boolean;
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
 * Returns `<projectRoot>/.codemap/recipes/` if it exists as a directory,
 * else `undefined`. Per plan §9 Q-C, root-only — no walk-up; same root
 * the CLI's `--root` / `CODEMAP_ROOT` resolves to.
 */
export function resolveProjectRecipesDir(
  projectRoot: string,
): string | undefined {
  const dir = join(projectRoot, ".codemap", "recipes");
  if (!existsSync(dir)) return undefined;
  if (!statSync(dir).isDirectory()) return undefined;
  return dir;
}

/**
 * Module-cached registry — populated lazily on first access (loader is pure;
 * the cache means we pay the filesystem read once per process lifetime per
 * plan §9 Q-B). Cache key includes `projectDir` so that a process running
 * against multiple roots (test fixtures, multi-root MCP sessions later)
 * re-resolves when the root changes.
 *
 * Per Tracer 5: `actions` come from YAML frontmatter on each `<id>.md` for
 * BOTH bundled and project recipes — uniform shape, no special-casing.
 */
let cachedRegistry: LoadedRecipe[] | undefined;
let cachedRegistryProjectDir: string | undefined;

function getRegistry(): LoadedRecipe[] {
  // `getProjectRoot()` throws if `initCodemap()` hasn't run; that only
  // happens for direct unit tests of this module pre-bootstrap. Treat
  // that as "no project recipes" — bundled-only registry.
  let projectDir: string | undefined;
  try {
    projectDir = resolveProjectRecipesDir(getProjectRoot());
  } catch {
    projectDir = undefined;
  }

  if (cachedRegistry !== undefined && cachedRegistryProjectDir === projectDir) {
    return cachedRegistry;
  }

  cachedRegistry = loadAllRecipes({
    bundledDir: resolveBundledRecipesDir(),
    projectDir,
  });
  cachedRegistryProjectDir = projectDir;
  return cachedRegistry;
}

/**
 * Reset the module cache — test-only escape hatch for fixture swaps.
 */
export function _resetRecipesCacheForTests(): void {
  cachedRegistry = undefined;
  cachedRegistryProjectDir = undefined;
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
 * Full catalog for **`codemap query --recipes-json`** and the
 * `codemap://recipes` MCP resource. Per Tracer 4, includes `body`,
 * `source`, and `shadows` fields on each entry.
 */
export function listQueryRecipeCatalog(): QueryRecipeCatalogEntry[] {
  return getRegistry().map((r) => buildCatalogEntry(r));
}

/**
 * Single-entry lookup for the `codemap://recipes/{id}` MCP resource and any
 * future `--recipe-json <id>` CLI shape. Returns `undefined` for unknown
 * ids; otherwise the same {@link QueryRecipeCatalogEntry} shape as the
 * full-catalog listing.
 */
export function getQueryRecipeCatalogEntry(
  id: string,
): QueryRecipeCatalogEntry | undefined {
  const recipe = getRegistry().find((r) => r.id === id);
  return recipe === undefined ? undefined : buildCatalogEntry(recipe);
}

function buildCatalogEntry(r: LoadedRecipe): QueryRecipeCatalogEntry {
  const entry: QueryRecipeCatalogEntry = {
    id: r.id,
    description: r.description ?? r.id,
    sql: r.sql,
    source: r.source,
  };
  if (r.body !== undefined) entry.body = r.body;
  if (r.actions !== undefined) entry.actions = r.actions;
  if (r.params !== undefined) entry.params = r.params;
  if (r.shadows) entry.shadows = true;
  return entry;
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

/**
 * Returns the declared parameter list for a recipe id (in bind order), or
 * `undefined` if the recipe is unknown OR declares no params. Used by the
 * CLI / MCP / HTTP layers to validate caller-supplied params via
 * `application/recipe-params.ts` before SQL binding.
 */
export function getQueryRecipeParams(id: string): RecipeParam[] | undefined {
  return getRegistry().find((r) => r.id === id)?.params;
}
