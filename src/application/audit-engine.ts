import { getQueryBaseline } from "../db";
import type { CodemapDatabase } from "../db";
import { diffRows } from "../diff-rows";
import { openCodemapDatabase } from "../sqlite-db";
import {
  isGitRepo,
  lookupCacheEntry,
  populateWorktree,
  resolveSha,
} from "./audit-worktree";
import type { PopulatedCacheEntry } from "./audit-worktree";
import { getCurrentCommit } from "./index-engine";

/**
 * Per-delta diff payload — the rows that drifted between baseline and current,
 * plus the snapshot metadata for that specific delta. Each delta carries its
 * own `base` because audits can mix baselines (one prefix auto-resolved across
 * three deltas, or three explicit per-delta overrides). Empty `added`/`removed`
 * arrays mean "no drift on this delta key" (not "delta wasn't computed" — that
 * key would be absent from the envelope's `deltas` map entirely).
 */
export interface AuditDelta {
  base: AuditBase;
  added: unknown[];
  removed: unknown[];
}

/**
 * Per-delta snapshot metadata — discriminated by `source`. `"baseline"` (B.6
 * reuse) loads rows from the `query_baselines` table; `"ref"` materialises the
 * snapshot via worktree + reindex (`--base <ref>`). Per-delta because audits
 * can mix sources (e.g. `--base origin/main --files-baseline pr-files`).
 */
export type AuditBase = AuditBaseFromBaseline | AuditBaseFromRef;

export interface AuditBaseFromBaseline {
  source: "baseline";
  name: string;
  sha: string | null;
  indexed_at: number;
}

export interface AuditBaseFromRef {
  source: "ref";
  /** User-supplied ref string (e.g. `origin/main`, `HEAD~5`, `v1.0.0`). */
  ref: string;
  /** Resolved sha — what `git rev-parse --verify` returned. */
  sha: string;
  /** When the worktree-side `.codemap.db` was last indexed (cache-mtime). */
  indexed_at: number;
}

/**
 * Current-state metadata at audit time. `indexed_at` reflects the live
 * `.codemap.db`'s last index run — `cmd-audit.ts` runs an incremental
 * index prelude (unless `--no-index`) so this is fresh by default.
 */
export interface AuditHead {
  sha: string | null;
  indexed_at: number;
}

/**
 * The audit envelope shape — `{head, deltas}`. Each delta in the map carries
 * its own `base` (per-delta baseline; see {@link AuditDelta}). Deltas the user
 * didn't request (no baseline → no entry) are absent from the map.
 *
 * v1 ships no `verdict` field; consumers compose `--json` + `jq` for CI exit
 * codes. v1.x adds `verdict: "pass" | "warn" | "fail"` driven by
 * `codemap.config.audit`.
 */
export interface AuditEnvelope {
  head: AuditHead;
  deltas: Record<string, AuditDelta>;
}

/**
 * The error returned when audit can't proceed (baseline not found, column-set
 * mismatch on a delta, etc.). The CLI surfaces it through the same
 * `{"error":"…"}` JSON shape as `cmd-query` errors.
 */
export interface AuditError {
  error: string;
}

/**
 * One delta in the v1 audit registry. Each delta:
 *
 * - has a stable kebab-case `key` exposed in the envelope's `deltas` map
 * - pins a canonical `sql` projection that runs on BOTH sides of the diff
 *   (the baseline's stored `sql` is informational — never replayed —
 *   so audits stay schema-drift-resilient per plan §4)
 * - declares `requiredColumns` the baseline rows must carry; the executor
 *   projects baseline rows down to this column set before diffing
 * - cites a `recipeIdHint` used in the error message when the column
 *   contract isn't satisfied
 */
export interface AuditDeltaSpec {
  key: string;
  sql: string;
  requiredColumns: string[];
  recipeIdHint: string;
}

/**
 * v1 delta registry — three deltas per plan §4. Adding a delta later is one
 * entry here + one entry in `requireColumns()`-tested fixtures. Removing one
 * is harder (consumer config breaks); defer-by-default.
 */
export const V1_DELTAS: readonly AuditDeltaSpec[] = [
  {
    key: "files",
    sql: "SELECT path FROM files ORDER BY path",
    requiredColumns: ["path"],
    recipeIdHint:
      'a query that returns `path` (e.g. `--recipe files-hashes` or `"SELECT path FROM files"`)',
  },
  {
    key: "dependencies",
    sql: "SELECT from_path, to_path FROM dependencies ORDER BY from_path, to_path",
    requiredColumns: ["from_path", "to_path"],
    recipeIdHint:
      'a query that returns `from_path` and `to_path` (e.g. `"SELECT from_path, to_path FROM dependencies"`)',
  },
  {
    key: "deprecated",
    sql: "SELECT name, kind, file_path FROM symbols WHERE doc_comment LIKE '%@deprecated%' ORDER BY file_path, name",
    requiredColumns: ["name", "kind", "file_path"],
    recipeIdHint:
      "the `deprecated-symbols` recipe (`--recipe deprecated-symbols`)",
  },
] as const;

/**
 * Map of delta key → baseline name. Caller assembles this from CLI flags:
 * explicit `--<delta>-baseline <name>` and/or auto-resolved `--baseline <prefix>`
 * (which probes `<prefix>-<delta-key>` for each known delta). Deltas absent
 * from the map don't run.
 */
export type AuditBaselineMap = Partial<Record<string, string>>;

/**
 * Compose the `AuditBaselineMap` from CLI / MCP arg shapes. Per-delta
 * explicit names override auto-resolved slots. Auto-resolved slots that
 * don't exist in `query_baselines` are silently absent — the delta just
 * doesn't run. Same shape both `cmd-audit.ts` and the MCP `audit` tool
 * call before handing off to {@link runAudit}.
 */
export function resolveAuditBaselines(opts: {
  db: CodemapDatabase;
  baselinePrefix: string | undefined;
  perDelta: Record<string, string>;
}): AuditBaselineMap {
  const map: AuditBaselineMap = {};
  for (const spec of V1_DELTAS) {
    if (opts.baselinePrefix !== undefined) {
      const candidate = `${opts.baselinePrefix}-${spec.key}`;
      if (getQueryBaseline(opts.db, candidate) !== undefined) {
        map[spec.key] = candidate;
      }
    }
  }
  // Per-delta flags override the auto-resolved slot for that key.
  for (const [key, name] of Object.entries(opts.perDelta)) {
    map[key] = name;
  }
  return map;
}

/**
 * Run an audit against the per-delta baseline mapping. Each requested delta
 * (key present in `baselines`) loads its baseline, validates column-set
 * membership, runs the canonical SQL, and emits a per-delta diff. Deltas
 * absent from the map are absent from the envelope's `deltas` map.
 *
 * Returns an `AuditError` when:
 * - The map is empty (caller should have already errored at parse time, but
 *   defensive).
 * - A delta's named baseline doesn't exist in `query_baselines`.
 * - A baseline's `rows_json` is corrupt or its column set doesn't satisfy the
 *   delta's contract.
 *
 * Caller owns the DB connection lifecycle and the index-prelude decision.
 */
export function runAudit(opts: {
  db: CodemapDatabase;
  baselines: AuditBaselineMap;
}): AuditEnvelope | AuditError {
  const requested = Object.keys(opts.baselines);
  if (requested.length === 0) {
    return {
      error:
        "codemap audit: no delta baselines provided. Pass --baseline <prefix> (auto-resolves <prefix>-files / <prefix>-dependencies / <prefix>-deprecated) or --<delta>-baseline <name> per delta.",
    };
  }

  const deltas: Record<string, AuditDelta> = {};
  for (const spec of V1_DELTAS) {
    const baselineName = opts.baselines[spec.key];
    if (baselineName === undefined) continue;

    const baseline = getQueryBaseline(opts.db, baselineName);
    if (baseline === undefined) {
      return {
        error: `codemap audit: no baseline named "${baselineName}" (requested for delta "${spec.key}"). Use \`codemap query --baselines\` to list saved baselines.`,
      };
    }

    let baselineRows: unknown[];
    try {
      const parsed = JSON.parse(baseline.rows_json) as unknown;
      if (!Array.isArray(parsed)) {
        return {
          error: `codemap audit: baseline "${baseline.name}" (delta "${spec.key}") has invalid rows_json (expected JSON array, got ${parsed === null ? "null" : typeof parsed}) — drop and re-save.`,
        };
      }
      baselineRows = parsed;
    } catch {
      return {
        error: `codemap audit: baseline "${baseline.name}" (delta "${spec.key}") has corrupt rows_json — drop and re-save.`,
      };
    }

    const diff = computeDelta(opts.db, baseline.name, baselineRows, spec);
    if ("error" in diff) return diff;

    deltas[spec.key] = {
      base: {
        source: "baseline",
        name: baseline.name,
        sha: baseline.git_ref,
        indexed_at: baseline.created_at,
      },
      ...diff,
    };
  }

  return {
    head: {
      sha: tryGetGitRef(),
      indexed_at: Date.now(),
    },
    deltas,
  };
}

/**
 * Validate baseline column-set + project + run live SQL + diff.
 * Pure function over `(db, baselineName, baselineRows, spec)` — easy to test
 * in isolation against an in-memory DB. Returns just the `{added, removed}`
 * payload; `runAudit` wraps it with the per-delta `base` metadata.
 */
export function computeDelta(
  db: CodemapDatabase,
  baselineName: string,
  baselineRows: unknown[],
  spec: AuditDeltaSpec,
): { added: unknown[]; removed: unknown[] } | AuditError {
  // Empty baselines pass — every required column is "trivially present"
  // because there are no rows to validate. Live rows are still real `added`s.
  if (baselineRows.length > 0) {
    const sample = baselineRows[0];
    if (typeof sample !== "object" || sample === null) {
      return {
        error: `codemap audit: baseline "${baselineName}" rows are not objects; delta "${spec.key}" needs columns [${spec.requiredColumns.join(", ")}]. Re-save with: codemap query --save-baseline=${baselineName} ${spec.recipeIdHint}`,
      };
    }
    const got = Object.keys(sample as object);
    const missing = spec.requiredColumns.filter((c) => !got.includes(c));
    if (missing.length > 0) {
      return {
        error: `codemap audit: baseline "${baselineName}" is missing required columns for delta "${spec.key}": got [${got.join(", ")}], need [${spec.requiredColumns.join(", ")}]. Re-save with: codemap query --save-baseline=${baselineName} ${spec.recipeIdHint}`,
      };
    }
  }

  const projectedBaseline = baselineRows.map((row) =>
    projectRow(row, spec.requiredColumns),
  );
  // Reuse the caller's DB connection (vs `queryRows(sql)` which opens a fresh
  // one — wasteful per delta and breaks the "caller owns the lifecycle" contract).
  const currentRows = db.query(spec.sql).all() as unknown[];
  const projectedCurrent = currentRows.map((row) =>
    projectRow(row, spec.requiredColumns),
  );

  return diffRows(projectedBaseline, projectedCurrent);
}

// Pick `cols` (in order) from `row` into a fresh object. Extra columns are
// dropped — keeps diff identity stable regardless of how the baseline was
// saved (e.g. `SELECT *` baselines stay diffable as schema columns are added).
function projectRow(row: unknown, cols: readonly string[]): unknown {
  if (typeof row !== "object" || row === null) return row;
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const c of cols) out[c] = src[c];
  return out;
}

// `git rev-parse HEAD` may legitimately fail (no git, detached worktree).
// Audit captures NULL in that case — same convention as B.6 baselines.
function tryGetGitRef(): string | null {
  try {
    const sha = getCurrentCommit();
    return sha || null;
  } catch {
    return null;
  }
}

/**
 * Reindex callback contract — `runAuditFromRef` injects this so the engine
 * stays decoupled from `application/run-index.ts` (which itself depends on
 * config + resolver + runtime singletons). Tracer 2 wires the production
 * implementation in `cmd-audit.ts`.
 */
export type ReindexFn = (worktreePath: string) => Promise<void>;

export interface RunAuditFromRefOpts {
  db: CodemapDatabase;
  ref: string;
  /**
   * Per-delta override map. When a delta key is present here, the delta
   * uses the saved baseline (`source: "baseline"`) instead of the worktree
   * (`source: "ref"`). Composes orthogonally with `--base` per plan §D7.
   */
  perDeltaOverrides?: AuditBaselineMap;
  projectRoot: string;
  reindex: ReindexFn;
}

/**
 * Run an audit with the base snapshot materialised from a git ref.
 * Resolves `<ref>` to a sha, reuses (or populates) the worktree cache,
 * runs each delta's canonical SQL on the cached `.codemap.db`, and diffs
 * against the live DB. Per-delta overrides escape to the existing
 * `query_baselines`-backed path.
 *
 * Mirrors {@link runAudit} but the "base rows" come from a sibling SQLite
 * file instead of `query_baselines`. Errors map to `AuditError` for the
 * same `{error}` shape the CLI / MCP / HTTP transports already render.
 */
export async function runAuditFromRef(
  opts: RunAuditFromRefOpts,
): Promise<AuditEnvelope | AuditError> {
  if (!isGitRepo(opts.projectRoot)) {
    return { error: "codemap audit: --base requires a git repository." };
  }

  const resolved = resolveSha(opts.ref, opts.projectRoot);
  if ("error" in resolved) return { error: resolved.error };
  const sha = resolved.sha;

  let entry: PopulatedCacheEntry | undefined = lookupCacheEntry(sha, {
    projectRoot: opts.projectRoot,
  });
  if (entry === undefined) {
    const populated = await populateWorktree({
      projectRoot: opts.projectRoot,
      sha,
      reindex: opts.reindex,
    });
    if ("error" in populated) return { error: populated.error };
    entry = populated;
  }

  const baseDb = openCodemapDatabase(entry.dbPath);
  try {
    const deltas: Record<string, AuditDelta> = {};
    const overrides = opts.perDeltaOverrides ?? {};
    for (const spec of V1_DELTAS) {
      const overrideName = overrides[spec.key];
      if (overrideName !== undefined) {
        const baselineDelta = computeDeltaFromBaseline(
          opts.db,
          overrideName,
          spec,
        );
        if ("error" in baselineDelta) return baselineDelta;
        deltas[spec.key] = baselineDelta;
        continue;
      }

      const baseRows = baseDb.query(spec.sql).all() as unknown[];
      const projectedBase = baseRows.map((row) =>
        projectRow(row, spec.requiredColumns),
      );
      const headRows = opts.db.query(spec.sql).all() as unknown[];
      const projectedHead = headRows.map((row) =>
        projectRow(row, spec.requiredColumns),
      );
      const diff = diffRows(projectedBase, projectedHead);

      deltas[spec.key] = {
        base: {
          source: "ref",
          ref: opts.ref,
          sha,
          indexed_at: entry.indexedAt,
        },
        ...diff,
      };
    }

    return {
      head: {
        sha: tryGetGitRef(),
        indexed_at: Date.now(),
      },
      deltas,
    };
  } finally {
    baseDb.close();
  }
}

/**
 * Replays the existing baseline-side flow for one delta — used by
 * `runAuditFromRef` when the user passes `--base <ref> --<delta>-baseline X`
 * to override one delta with a saved baseline (per plan §D7).
 */
function computeDeltaFromBaseline(
  db: CodemapDatabase,
  baselineName: string,
  spec: AuditDeltaSpec,
): AuditDelta | AuditError {
  const baseline = getQueryBaseline(db, baselineName);
  if (baseline === undefined) {
    return {
      error: `codemap audit: no baseline named "${baselineName}" (requested for delta "${spec.key}"). Use \`codemap query --baselines\` to list saved baselines.`,
    };
  }
  let baselineRows: unknown[];
  try {
    const parsed = JSON.parse(baseline.rows_json) as unknown;
    if (!Array.isArray(parsed)) {
      return {
        error: `codemap audit: baseline "${baseline.name}" (delta "${spec.key}") has invalid rows_json — drop and re-save.`,
      };
    }
    baselineRows = parsed;
  } catch {
    return {
      error: `codemap audit: baseline "${baseline.name}" (delta "${spec.key}") has corrupt rows_json — drop and re-save.`,
    };
  }
  const diff = computeDelta(db, baseline.name, baselineRows, spec);
  if ("error" in diff) return diff;
  return {
    base: {
      source: "baseline",
      name: baseline.name,
      sha: baseline.git_ref,
      indexed_at: baseline.created_at,
    },
    ...diff,
  };
}
