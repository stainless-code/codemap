/**
 * Pure transport-agnostic engine for `codemap apply <recipe-id>` — substrate-
 * shaped fix executor. Consumes the same `{file_path, line_start,
 * before_pattern, after_pattern}` row contract `buildDiffJson` emits and
 * either previews (dry-run) or applies the edits to disk.
 *
 * Phase 1 validates every row against current disk state; phase 2 (gated on
 * `!dryRun && conflicts.length === 0`) writes each modified file via temp +
 * rename for crash-safe per-file atomicity. See
 * [`docs/plans/codemap-apply.md`](../../docs/plans/codemap-apply.md) for the
 * full design (Q1–Q10 locked).
 *
 * TOCTOU note: phase-1 caches the source it validated; phase-2 transforms
 * the cached source and writes the result. The window between read and
 * write is a deliberate v1 simplification (Q2) — apply isn't an adversarial
 * verb, so we don't add lock-file machinery.
 *
 * EOL note: phase-2 splits source on raw `"\n"` (NOT `/\r?\n/`) so CRLF
 * lines retain their trailing `\r` and round-trip when joined back with
 * `"\n"`. Patterns that include a literal `\r` are out of scope for v1;
 * recipe authors should target identifier-shaped patterns.
 */

import { randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
  | "line content drifted";

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
  let validRows = 0;

  for (const row of rows) {
    const filePath = readString(row, "file_path");
    const lineStart = readPositiveInt(row, "line_start");
    const before = readString(row, "before_pattern");
    const after = readString(row, "after_pattern");
    if (
      filePath === undefined ||
      lineStart === undefined ||
      before === undefined ||
      after === undefined
    ) {
      continue;
    }
    validRows++;

    let source = sourceCache.get(filePath);
    if (source === undefined) {
      try {
        source = readFileSync(join(projectRoot, filePath), "utf8");
      } catch {
        conflicts.push({
          file_path: filePath,
          line_start: lineStart,
          before_pattern: before,
          actual_at_line: "",
          reason: "file missing",
        });
        continue;
      }
      sourceCache.set(filePath, source);
    }
    // Phase-1 splits on `/\r?\n/` so the `actual_at_line` reported in
    // conflicts doesn't carry a stray `\r`. Phase-2 re-splits on raw `\n`
    // for round-trip-safe writes (see EOL note in module docstring).
    const lines = source.split(/\r?\n/);
    const actual = lines[lineStart - 1];
    if (actual === undefined) {
      conflicts.push({
        file_path: filePath,
        line_start: lineStart,
        before_pattern: before,
        actual_at_line: "",
        reason: "line out of range",
      });
      continue;
    }
    if (!actual.includes(before)) {
      conflicts.push({
        file_path: filePath,
        line_start: lineStart,
        before_pattern: before,
        actual_at_line: actual,
        reason: "line content drifted",
      });
      continue;
    }

    const edits = pending.get(filePath);
    if (edits === undefined) {
      pending.set(filePath, [
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
    if (filePath !== undefined) distinctInputFiles.add(filePath);
  }

  // Q2 (c) — any conflict aborts the whole run; dry-run never writes either.
  // Both branches return the same envelope shape (Q5).
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

  // Phase 2 — apply edits per-file via temp + rename.
  const writtenFiles: ApplyFile[] = [];
  let appliedRows = 0;
  for (const filePath of [...pending.keys()].sort()) {
    const edits = pending.get(filePath)!;
    const cachedSource = sourceCache.get(filePath)!;
    // Re-split the cached source on raw `"\n"` (not `/\r?\n/`) so CRLF
    // lines retain their trailing `\r` and rejoin losslessly.
    const fileLines = cachedSource.split("\n");
    // Apply edits in descending line order — defensive default for when
    // multi-line transforms land (today every row is a single-line
    // replacement so order doesn't actually matter).
    edits.sort((a, b) => b.line_start - a.line_start);
    for (const edit of edits) {
      const idx = edit.line_start - 1;
      const actual = fileLines[idx];
      // The cached source was validated in phase 1; re-checking here guards
      // against future regressions where the cache and validation drift.
      if (actual === undefined || !actual.includes(edit.before_pattern)) {
        throw new Error(
          `apply-engine: phase-2 invariant violated at ${filePath}:${edit.line_start} — phase-1 cache out of sync.`,
        );
      }
      // Pre-escape `$` per `String.prototype.replace` GetSubstitution rule
      // so identifiers like `$inject` round-trip safely (mirrors
      // `buildDiffJson`).
      fileLines[idx] = actual.replace(
        edit.before_pattern,
        edit.after_pattern.replace(/\$/g, "$$$$"),
      );
    }

    const newContent = fileLines.join("\n");
    const absPath = join(projectRoot, filePath);
    // Sibling temp + `rename`: POSIX-atomic when source and destination
    // share a filesystem (always true for siblings). A concurrent reader
    // sees either the pre-rename or post-rename content — never a torn
    // write.
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

function readPositiveInt(
  row: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = row[key];
  return Number.isInteger(value) && typeof value === "number" && value > 0
    ? value
    : undefined;
}
