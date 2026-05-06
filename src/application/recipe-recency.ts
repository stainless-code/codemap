import { isAbsolute, resolve } from "node:path";

import { closeDb, openDb } from "../db";
import type { CodemapDatabase } from "../db";
import { getRecipeRecencyEnabled } from "../runtime";
import { STATE_DIR_DEFAULT } from "./state-dir";

/**
 * One row of the `recipe_recency` table. See [`docs/architecture.md` §
 * `recipe_recency`](../../docs/architecture.md#recipe_recency--per-recipe-last-run--run-count-user-data-strict-without-rowid)
 * for the lifecycle and rejected-column rationale.
 */
export interface RecipeRecencyRow {
  recipe_id: string;
  last_run_at: number;
  run_count: number;
}

/** 90-day rolling retention window. Tests inject `cutoffMs` directly. */
export const RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

interface RecordRunOpts {
  db: CodemapDatabase;
  recipeId: string;
  /** Override for tests; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Eager prune + upsert. Pruning runs on the write path (not the read path)
 * so catalog reads stay pure — Slice 5 audit caught that lazy-on-read
 * violated the "No DB required" contract for `--recipes-json` and the
 * MCP `codemap://recipes` resource. Single indexed DELETE on a tiny
 * table (~recipe-id-cardinality rows) is cheap enough to justify
 * write-side eagerness; reads now filter on `last_run_at >= cutoff`
 * without writing.
 *
 * Caller is `tryRecordRecipeRun` (which guards the "successful run only"
 * contract).
 */
export function recordRecipeRun(opts: RecordRunOpts): void {
  const { db, recipeId } = opts;
  const now = opts.now ?? Date.now();
  db.run("DELETE FROM recipe_recency WHERE last_run_at < ?", [
    now - RECENCY_WINDOW_MS,
  ]);
  db.run(
    `INSERT INTO recipe_recency (recipe_id, last_run_at, run_count)
     VALUES (?, ?, 1)
     ON CONFLICT(recipe_id) DO UPDATE SET
       last_run_at = excluded.last_run_at,
       run_count   = recipe_recency.run_count + 1`,
    [recipeId, now],
  );
}

/**
 * The wrapper both write sites call (`handleQueryRecipe` for MCP/HTTP +
 * `runQueryCmd` for CLI). Opens its own DB because `executeQuery` runs
 * with `PRAGMA query_only = 1` and can't double as the writer. Swallows
 * every error — recency-write failures NEVER block the recipe response.
 *
 * Caller contract: only call AFTER recipe execution returns successfully.
 *
 * `_openDb` is a test seam — production omits it.
 */
export function tryRecordRecipeRun(
  recipeId: string,
  opts?: { quiet?: boolean; _openDb?: () => CodemapDatabase },
): void {
  // Bail before openDb when opt-out config is set. The toggle-getter
  // throws when the runtime isn't initialised (CLI smoke paths before
  // bootstrap); the outer try/catch swallows that, so behaviour stays
  // identical to a real DB failure.
  try {
    if (!getRecipeRecencyEnabled()) return;
  } catch {
    // Runtime not initialised — let the openDb path try.
  }
  let db: CodemapDatabase | undefined;
  try {
    db = (opts?._openDb ?? openDb)();
    recordRecipeRun({ db, recipeId });
  } catch (err) {
    if (!opts?.quiet) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[recency] write failed: ${msg}`);
    }
  } finally {
    if (db !== undefined) {
      try {
        closeDb(db);
      } catch {
        // Already in error path; nothing useful to do.
      }
    }
  }
}

interface PruneOpts {
  db: CodemapDatabase;
  /** Cutoff epoch ms — rows with `last_run_at < cutoffMs` get deleted. */
  cutoffMs: number;
}

/**
 * Maintenance helper — exposed for tests / future ad-hoc CLI verbs. Production
 * pruning lives inside `recordRecipeRun` (write-side eager); reads never call
 * this so the catalog stays pure.
 */
export function pruneRecipeRecency(opts: PruneOpts): void {
  const { db, cutoffMs } = opts;
  db.run("DELETE FROM recipe_recency WHERE last_run_at < ?", [cutoffMs]);
}

interface LoadOpts {
  db: CodemapDatabase;
  /** Override for tests; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Pure read for `--recipes-json` + `codemap://recipes` resources. Filters
 * to within the 90-day window via `WHERE last_run_at >= ?` — never DELETEs,
 * so the catalog read site stays side-effect free. Stale rows are pruned
 * on the next `recordRecipeRun` write (eager prune-then-upsert). Returns a
 * Map keyed by `recipe_id` so the catalog renderer can
 * `map.get(entry.id) ?? null` for never-run recipes.
 */
export function loadRecipeRecency(
  opts: LoadOpts,
): Map<string, { last_run_at: number; run_count: number }> {
  const { db } = opts;
  const now = opts.now ?? Date.now();
  const cutoff = now - RECENCY_WINDOW_MS;
  const rows = db
    .query<RecipeRecencyRow>(
      "SELECT recipe_id, last_run_at, run_count FROM recipe_recency WHERE last_run_at >= ?",
    )
    .all(cutoff);
  const map = new Map<string, { last_run_at: number; run_count: number }>();
  for (const row of rows) {
    map.set(row.recipe_id, {
      last_run_at: row.last_run_at,
      run_count: row.run_count,
    });
  }
  return map;
}

/**
 * Per-entry shape inlined onto every `--recipes-json` row. `null` /
 * `0` for recipes never executed.
 */
export interface RecipeRecencyFields {
  last_run_at: number | null;
  run_count: number;
}

/**
 * Resolve `<state-dir>/index.db` from CLI inputs without mutating the
 * runtime singleton — `--recipes-json` runs before `initCodemap()` and
 * must stay zero-side-effect. Mirrors `resolveStateDir` precedence
 * (`cliFlag > env > default`).
 */
export function resolveRecencyDbPath(opts: {
  root: string;
  stateDir: string | undefined;
}): string {
  const raw =
    opts.stateDir ?? process.env.CODEMAP_STATE_DIR ?? STATE_DIR_DEFAULT;
  const dir = isAbsolute(raw) ? raw : resolve(opts.root, raw);
  return resolve(dir, "index.db");
}

/**
 * Read-side enricher for `--recipes-json` + the matching MCP/HTTP catalog
 * resources. Live every call — caching at this layer would freeze recency
 * at first-read for the lifetime of `codemap mcp` / `codemap serve`.
 *
 * Failure-isolated like {@link tryRecordRecipeRun}: any DB-open / read
 * failure returns entries with `null` / `0` fallbacks. The optional
 * `openDb` factory is for callers without an `initCodemap()` runtime
 * (CLI `--recipes-json` before bootstrap supplies a path-based opener).
 */
export function enrichWithRecency<T extends { id: string }>(
  entries: ReadonlyArray<T>,
  opts?: { openDb?: () => CodemapDatabase },
): Array<T & RecipeRecencyFields> {
  let map: Map<string, { last_run_at: number; run_count: number }> | undefined;
  let db: CodemapDatabase | undefined;
  try {
    db = (opts?.openDb ?? openDb)();
    map = loadRecipeRecency({ db });
  } catch {
    // Recency errors NEVER block the catalog — null/0 fallbacks below.
    map = undefined;
  } finally {
    if (db !== undefined) {
      try {
        closeDb(db, { readonly: true });
      } catch {
        // Already in error path; nothing useful to do.
      }
    }
  }
  return entries.map((entry) => {
    const hit = map?.get(entry.id);
    return {
      ...entry,
      last_run_at: hit?.last_run_at ?? null,
      run_count: hit?.run_count ?? 0,
    };
  });
}
