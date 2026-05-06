/**
 * Pure transport-agnostic engine for `codemap apply <recipe-id>` — substrate-
 * shaped fix executor over the `{file_path, line_start, before_pattern,
 * after_pattern}` row contract `buildDiffJson` emits.
 *
 * Phase 1 validates every row against current disk; phase 2 (gated on
 * `!dryRun && conflicts.length === 0`) writes each modified file via
 * sibling temp + `rename` for crash-safe per-file atomicity. Full design
 * (Q1–Q10 locks, semantics, exit codes) at
 * [`docs/architecture.md`](../../docs/architecture.md) § Apply wiring.
 *
 * Four behaviours called out here because the code alone won't betray them:
 *
 * - **Same-line ambiguity.** `actual.replace(before, after)` is first-
 *   occurrence — mirrors `buildDiffJson` verbatim. `const foo = foo();`
 *   with `before = "foo"` rewrites only the leftmost; recipe authors
 *   normalise their SQL or accept the formatter-parity behaviour.
 * - **Phase-2 I/O failures are NOT transactional across files.** Q2 (c)
 *   guarantees no partial state when phase 1 collects a conflict — phase 2
 *   doesn't run. But once phase 2 starts, a `writeFileSync` / `renameSync`
 *   crash on file N leaves files `1..N-1` already renamed with no rollback.
 *   Per-file atomicity (temp + rename) is preserved; cross-file rollback
 *   would require pre-write backups + a restore loop and is deferred.
 * - **TOCTOU.** Phase-1 caches the source it validated; phase-2 transforms
 *   the cache and writes. The read→rename window is a v1 simplification
 *   (apply isn't adversarial; no lock files).
 * - **EOL.** Phase-2 splits on raw `"\n"` (NOT `/\r?\n/`) so CRLF lines
 *   keep their trailing `\r` and round-trip on rejoin. Patterns containing
 *   `\r` are out of scope for v1.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve, sep } from "node:path";

/** Required input columns on every recipe row. */
export interface ApplyInputRow extends Record<string, unknown> {
  file_path: string;
  line_start: number;
  before_pattern: string;
  after_pattern: string;
}

export interface ApplyDiffPayloadOpts {
  /** Recipe / SQL row set. Rows missing required keys are silently skipped. */
  rows: Record<string, unknown>[];
  /** Absolute or process-cwd-relative root used when reading `file_path` from disk. */
  projectRoot: string;
  /** `true` previews; `false` writes (gated on a clean phase 1). */
  dryRun: boolean;
}

/**
 * Per-file roll-up. `rows_applied` is `0` in dry-run mode and `0` in apply
 * mode when phase 1 collected any conflicts (Q2 (c) — all-or-nothing per
 * recipe-run aborts before any writes).
 */
export interface ApplyFile {
  file_path: string;
  rows_applied: number;
  warnings?: string[];
}

/** One conflict emitted by phase-1 validation. */
export interface ConflictRow {
  file_path: string;
  line_start: number;
  before_pattern: string;
  /** Disk content at `line_start` (1-indexed); `""` if file missing / line out of range. */
  actual_at_line: string;
  /** Human-readable reason; one of the fixed strings below. */
  reason: ConflictReason;
}

export type ConflictReason =
  | "file missing"
  | "line out of range"
  | "line content drifted"
  | "path escapes project root"
  | "duplicate edit on same line";

/** Q5 envelope shape — single shape across `dry-run` and `apply` modes. */
export interface ApplyJsonPayload {
  mode: "dry-run" | "apply";
  /** `true` only when `mode === "apply"` AND zero conflicts AND at least one row applied. */
  applied: boolean;
  files: ApplyFile[];
  conflicts: ConflictRow[];
  summary: {
    /** Distinct `file_path`s in the input row set. */
    files: number;
    /** `0` in dry-run; equals `files[].length` post-apply when conflict-free. */
    files_modified: number;
    /** Total well-shaped input rows (rows missing required keys are skipped). */
    rows: number;
    /** `0` in dry-run; sum of `files[].rows_applied` post-apply. */
    rows_applied: number;
    conflicts: number;
    /** Distinct `file_path`s with at least one conflict. */
    files_with_conflicts: number;
  };
}

/** Internal — one validated edit collected during phase 1. */
interface PendingEdit {
  line_start: number;
  before_pattern: string;
  after_pattern: string;
}

/**
 * Run the apply pipeline. Always runs phase 1 (validation); phase 2 (write)
 * is gated on `!dryRun && conflicts.length === 0`.
 */
export function applyDiffPayload(opts: ApplyDiffPayloadOpts): ApplyJsonPayload {
  const { rows, projectRoot, dryRun } = opts;

  const conflicts: ConflictRow[] = [];
  const pending = new Map<string, PendingEdit[]>();
  // Phase-1 reads each file at most once; phase 2 reuses the cached source.
  const sourceCache = new Map<string, string>();
  // No `realpath` — same `resolve` semantics on both sides keep symlinked
  // roots from false-positiving on their own descendants.
  const resolvedRoot = resolve(projectRoot);
  // Tracks `(file_path, line_start)` tuples already collected so the
  // duplicate-edit conflict fires in phase 1 — without it the second row
  // would split phase 2 mid-loop and leak Q2 (c) all-or-nothing.
  const seenLines = new Map<string, Set<number>>();
  let validRows = 0;

  for (const row of rows) {
    const filePath = readString(row, "file_path");
    const lineStart = readPositiveInt(row, "line_start");
    const before = readString(row, "before_pattern");
    // `after_pattern: ""` is the deletion case — `actual.replace(before, "")`
    // strips the leftmost match. Empty `before_pattern` stays disallowed
    // (would match anywhere on the line, including the start).
    const after = readStringAllowEmpty(row, "after_pattern");
    if (
      filePath === undefined ||
      lineStart === undefined ||
      before === undefined ||
      after === undefined
    ) {
      continue;
    }
    validRows++;

    // Path-containment guard — without it `file_path: "../escape.ts"` would
    // write sibling-of-root files (CLI + MCP + HTTP all share this engine).
    if (isAbsolute(filePath) || !isWithinRoot(resolvedRoot, filePath)) {
      conflicts.push({
        file_path: filePath,
        line_start: lineStart,
        before_pattern: before,
        actual_at_line: "",
        reason: "path escapes project root",
      });
      continue;
    }

    // Canonicalise to a single key so `a.ts`, `./a.ts`, and `src/../a.ts`
    // all dedup into the same cache + pending entry. Without this, two
    // rows naming the same disk file via different spellings would race in
    // phase 2 — second writeFileSync clobbers the first edit.
    const canonicalPath = canonicalizeFilePath(resolvedRoot, filePath);

    let source = sourceCache.get(canonicalPath);
    if (source === undefined) {
      try {
        source = readFileSync(resolve(resolvedRoot, canonicalPath), "utf8");
      } catch {
        conflicts.push({
          file_path: canonicalPath,
          line_start: lineStart,
          before_pattern: before,
          actual_at_line: "",
          reason: "file missing",
        });
        continue;
      }
      sourceCache.set(canonicalPath, source);
    }
    // Phase-1 splits on `/\r?\n/` so `actual_at_line` is `\r`-free; phase-2
    // re-splits on raw `\n` for round-trip-safe writes (module docstring § EOL).
    const lines = source.split(/\r?\n/);
    const actual = lines[lineStart - 1];
    if (actual === undefined) {
      conflicts.push({
        file_path: canonicalPath,
        line_start: lineStart,
        before_pattern: before,
        actual_at_line: "",
        reason: "line out of range",
      });
      continue;
    }
    if (!actual.includes(before)) {
      conflicts.push({
        file_path: canonicalPath,
        line_start: lineStart,
        before_pattern: before,
        actual_at_line: actual,
        reason: "line content drifted",
      });
      continue;
    }

    // Reject the second-and-subsequent rows targeting one line — see
    // `seenLines` declaration for the Q2 (c) violation this guards.
    const seen = seenLines.get(canonicalPath);
    if (seen !== undefined && seen.has(lineStart)) {
      conflicts.push({
        file_path: canonicalPath,
        line_start: lineStart,
        before_pattern: before,
        actual_at_line: actual,
        reason: "duplicate edit on same line",
      });
      continue;
    }
    if (seen === undefined) {
      seenLines.set(canonicalPath, new Set([lineStart]));
    } else {
      seen.add(lineStart);
    }

    const edits = pending.get(canonicalPath);
    if (edits === undefined) {
      pending.set(canonicalPath, [
        { line_start: lineStart, before_pattern: before, after_pattern: after },
      ]);
    } else {
      edits.push({
        line_start: lineStart,
        before_pattern: before,
        after_pattern: after,
      });
    }
  }

  const filesWithConflicts = new Set(conflicts.map((c) => c.file_path)).size;
  const distinctInputFiles = new Set<string>();
  for (const row of rows) {
    const filePath = readString(row, "file_path");
    if (filePath === undefined) continue;
    // Count distinct disk targets, not distinct spellings — same as the
    // dedup applied to the cache + pending keys.
    if (isAbsolute(filePath) || !isWithinRoot(resolvedRoot, filePath)) {
      distinctInputFiles.add(filePath);
    } else {
      distinctInputFiles.add(canonicalizeFilePath(resolvedRoot, filePath));
    }
  }

  // Q2 (c) — any conflict aborts the run; dry-run never writes. Same Q5 envelope.
  if (dryRun || conflicts.length > 0) {
    const files: ApplyFile[] =
      conflicts.length === 0
        ? [...pending.keys()].sort().map((file_path) => ({
            file_path,
            rows_applied: 0,
          }))
        : [];
    return {
      mode: dryRun ? "dry-run" : "apply",
      applied: false,
      files,
      conflicts,
      summary: {
        files: distinctInputFiles.size,
        files_modified: 0,
        rows: validRows,
        rows_applied: 0,
        conflicts: conflicts.length,
        files_with_conflicts: filesWithConflicts,
      },
    };
  }

  // Phase 2 — write each modified file via sibling temp + `rename`.
  const writtenFiles: ApplyFile[] = [];
  let appliedRows = 0;
  for (const filePath of [...pending.keys()].sort()) {
    const edits = pending.get(filePath)!;
    const cachedSource = sourceCache.get(filePath)!;
    const fileLines = cachedSource.split("\n");
    // Descending order is a defensive default — single-line replacements
    // are index-stable today, but multi-line transforms aren't.
    edits.sort((a, b) => b.line_start - a.line_start);
    for (const edit of edits) {
      const idx = edit.line_start - 1;
      const actual = fileLines[idx];
      if (actual === undefined || !actual.includes(edit.before_pattern)) {
        throw new Error(
          `apply-engine: phase-2 invariant violated at ${filePath}:${edit.line_start} — phase-1 cache out of sync.`,
        );
      }
      // Pre-escape `$` per `String.prototype.replace` GetSubstitution so
      // identifiers like `$inject` round-trip safely (mirrors `buildDiffJson`).
      fileLines[idx] = actual.replace(
        edit.before_pattern,
        edit.after_pattern.replace(/\$/g, "$$$$"),
      );
    }

    const newContent = fileLines.join("\n");
    const absPath = resolve(resolvedRoot, filePath);
    // POSIX-atomic when src + dst share a filesystem (true for siblings) —
    // concurrent readers see pre- or post-rename content, never a torn write.
    const tempPath = `${absPath}.codemap-apply-${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tempPath, newContent, "utf8");
    renameSync(tempPath, absPath);

    writtenFiles.push({ file_path: filePath, rows_applied: edits.length });
    appliedRows += edits.length;
  }

  return {
    mode: "apply",
    applied: writtenFiles.length > 0,
    files: writtenFiles,
    conflicts: [],
    summary: {
      files: distinctInputFiles.size,
      files_modified: writtenFiles.length,
      rows: validRows,
      rows_applied: appliedRows,
      conflicts: 0,
      files_with_conflicts: 0,
    },
  };
}

function readString(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Like {@link readString} but admits `""` — used for `after_pattern` (deletion). */
function readStringAllowEmpty(
  row: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = row[key];
  return typeof value === "string" ? value : undefined;
}

function readPositiveInt(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = row[key];
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : undefined;
}

/** `true` iff `resolve(resolvedRoot, candidate)` lands inside `resolvedRoot`. */
function isWithinRoot(resolvedRoot: string, candidate: string): boolean {
  const resolved = resolve(resolvedRoot, candidate);
  if (resolved === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return resolved.startsWith(prefix);
}

/**
 * Canonical project-relative form for the `pending` / `sourceCache` /
 * `seenLines` keys. `a.ts`, `./a.ts`, `src/../a.ts` all collapse to `a.ts`.
 * Caller has already verified `isWithinRoot(resolvedRoot, candidate)` so
 * the result is guaranteed in-tree.
 */
function canonicalizeFilePath(resolvedRoot: string, candidate: string): string {
  const absolute = resolve(resolvedRoot, candidate);
  if (absolute === resolvedRoot) return "";
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return absolute.slice(prefix.length);
}
