import { isAbsolute, resolve } from "node:path";

import { closeDb, openDb } from "../db";
import type { CodemapDatabase } from "../db";
import { STATE_DIR_DEFAULT } from "./state-dir";

/**
 * One row of the `recipe_recency` table. The shape is intentionally minimal —
 * `first_run_at` / `source` / `errored_run_count` were rejected for v1 per the
 * Q1 resolution in `docs/plans/recipe-recency.md` (locked schema; additive
 * promotion path if a real consumer asks).
 */
export interface RecipeRecencyRow {
  recipe_id: string;
  last_run_at: number;
  run_count: number;
}

/**
 * 90-day rolling retention window. Plan L.3. Exposed for tests; production
 * call sites should use the `cutoffMs` argument on `pruneRecipeRecency` so
 * the boundary is testable without freezing time.
 */
export const RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

interface RecordRunOpts {
  db: CodemapDatabase;
  recipeId: string;
  /** Override for tests; defaults to `Date.now()`. */
  now?: number;
}

/**
 * Write site for both transports (plan Q2 / L.2): `handleQueryRecipe` in
 * `tool-handlers.ts` (covers MCP + HTTP) and `runQueryCmd` in `cmd-query.ts`
 * (covers CLI). Pure upsert — Q3 locks pruning to the read path so the
 * recipe-execution hot path stays cheap.
 *
 * Counts only successful runs (Q9): callers wrap this in a `try/catch`
 * AFTER the recipe execution returns successfully, so any throw exits before
 * we reach this site. The `try/catch` itself is for L.8 failure isolation —
 * a recency-write failure (DB locked, disk full, schema drift) must NEVER
 * block the recipe response.
 */
export function recordRecipeRun(opts: RecordRunOpts): void {
  const { db, recipeId } = opts;
  const now = opts.now ?? Date.now();
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
 * Slice 2 wrapper for the two write sites (`handleQueryRecipe` +
 * `runQueryCmd`). Opens its own DB connection because `executeQuery` runs
 * with `PRAGMA query_only = 1` and can't double as the writer. Swallows
 * every error (L.8 + Q10) — recency-write failures NEVER block the recipe
 * response. Warning-on-stderr unless `quiet`.
 *
 * Caller responsibility: only call AFTER the recipe execution returns
 * successfully (Q9 — count successful runs only).
 *
 * `_openDb` is a test seam — production callers omit it; the failure-mode
 * test injects a thrower to confirm the swallow / warn path.
 */
export function tryRecordRecipeRun(
  recipeId: string,
  opts?: { quiet?: boolean; _openDb?: () => CodemapDatabase },
): void {
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
 * Lazy prune (Q3 resolution): called from `loadRecipeRecency` before its
 * SELECT, NOT from `recordRecipeRun`. Keeps the write path a pure upsert
 * and concentrates the staleness signal at read time, where consumers
 * actually observe it.
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
 * Read path consumed by Slice 3 (`--recipes-json` inline join, MCP
 * `codemap://recipes` resource, HTTP mirror). Returns a Map keyed by
 * `recipe_id` so the catalog renderer can `map.get(entry.id) ?? null`
 * for never-run recipes. Runs the lazy prune before the SELECT (Q3).
 */
export function loadRecipeRecency(
  opts: LoadOpts,
): Map<string, { last_run_at: number; run_count: number }> {
  const { db } = opts;
  const now = opts.now ?? Date.now();
  pruneRecipeRecency({ db, cutoffMs: now - RECENCY_WINDOW_MS });
  const rows = db
    .query<RecipeRecencyRow>(
      "SELECT recipe_id, last_run_at, run_count FROM recipe_recency",
    )
    .all();
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
 * Inline-join shape for `--recipes-json` and the matching MCP resources
 * (Q5 Resolution: per-entry inline fields, not a separate top-level
 * `recency:` map). `last_run_at: null` / `run_count: 0` for recipes
 * never executed; consumers filter with `select(.last_run_at != null)`
 * or treat null as fresh.
 */
export interface RecipeRecencyFields {
  last_run_at: number | null;
  run_count: number;
}

/**
 * Resolve the absolute path to `<state-dir>/index.db` from the same
 * inputs the CLI's `bootstrap-codemap` would use, WITHOUT mutating the
 * global runtime singleton. Slice 3's `--recipes-json` flow runs before
 * `initCodemap()` (the catalog has historically been "no DB required"),
 * so the path-resolver lets us read recency without taking on the
 * config / state-dir reconciliation side effects.
 *
 * Mirrors `application/state-dir.ts` `resolveStateDir` precedence:
 * `cliFlag > env > default`.
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
 * Slice 3 read-side enricher. Opens its own DB to read recency live —
 * NEVER cached on the MCP/HTTP transports because the catalog resource
 * runs inside long-lived `codemap mcp` / `codemap serve` sessions; a
 * cached snapshot would freeze recency at first-read forever per server
 * lifetime.
 *
 * Failure-isolated like {@link tryRecordRecipeRun} — a DB-open failure
 * returns the input entries enriched with `null` / `0` fallbacks, never
 * throws. The optional `openDb` factory lets callers without an
 * `initCodemap()` runtime (e.g. CLI `--recipes-json` before bootstrap)
 * supply a path-based opener; the test seam reuses the same hook.
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
    // Same posture as tryRecordRecipeRun (L.8) — recency errors NEVER
    // block the catalog response. Caller gets entries with null/0
    // fallbacks; the `--recipes-json` shape stays stable.
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
