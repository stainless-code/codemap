import { getQueryBaseline } from "../db";
import type { CodemapDatabase } from "../db";
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
 * Run an audit against the named baseline. Returns the structured envelope
 * on success or an `AuditError` when the baseline is missing / malformed.
 *
 * Caller owns the DB connection lifecycle. Caller is also responsible for
 * deciding whether to run an index prelude — the audit reads whatever the
 * DB currently holds.
 *
 * v1: deltas object is empty. Tracer 2+ fills it.
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
    deltas: {},
  };
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
