import { getQueryBaseline } from "../db";
import type { CodemapDatabase } from "../db";
import { diffRows } from "../diff-rows";
import { getCurrentCommit } from "./index-engine";

/**
 * Per-delta diff payload — the rows that drifted between baseline and current.
 * Empty arrays mean "no drift on this delta key" (not "delta wasn't computed").
 */
export interface AuditDelta {
  added: unknown[];
  removed: unknown[];
}

/**
 * Snapshot the audit was diffed against. v1 always has `source: "baseline"`
 * (B.6 reuse); v1.x adds `source: "ref"` for the worktree+reindex path.
 */
export interface AuditBase {
  source: "baseline";
  name: string;
  sha: string | null;
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
 * The audit envelope shape — `{base, head, deltas}`. v1 ships no `verdict`
 * field; consumers compose `--json` + `jq` for CI exit codes. v1.x adds
 * `verdict: "pass" | "warn" | "fail"` driven by `codemap.config.audit`.
 */
export interface AuditEnvelope {
  base: AuditBase;
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
] as const;

/**
 * Run an audit against the named baseline. Returns the structured envelope
 * on success or an `AuditError` when the baseline is missing / malformed /
 * fails a delta's column-set contract.
 *
 * Caller owns the DB connection lifecycle. Caller is also responsible for
 * deciding whether to run an index prelude — the audit reads whatever the
 * DB currently holds.
 */
export function runAudit(opts: {
  db: CodemapDatabase;
  baselineName: string;
}): AuditEnvelope | AuditError {
  const baseline = getQueryBaseline(opts.db, opts.baselineName);
  if (baseline === undefined) {
    return {
      error: `codemap audit: no baseline named "${opts.baselineName}". Use \`codemap query --baselines\` to list saved baselines.`,
    };
  }

  let baselineRows: unknown[];
  try {
    baselineRows = JSON.parse(baseline.rows_json) as unknown[];
  } catch {
    return {
      error: `codemap audit: baseline "${baseline.name}" has corrupt rows_json — drop and re-save.`,
    };
  }

  const deltas: Record<string, AuditDelta> = {};
  for (const spec of V1_DELTAS) {
    const result = computeDelta(opts.db, baseline.name, baselineRows, spec);
    if ("error" in result) return result;
    deltas[spec.key] = result;
  }

  return {
    base: {
      source: "baseline",
      name: baseline.name,
      sha: baseline.git_ref,
      indexed_at: baseline.created_at,
    },
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
 * in isolation against an in-memory DB.
 */
export function computeDelta(
  db: CodemapDatabase,
  baselineName: string,
  baselineRows: unknown[],
  spec: AuditDeltaSpec,
): AuditDelta | AuditError {
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
