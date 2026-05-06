/**
 * Pure transport-agnostic engine for `codemap apply <recipe-id>` — substrate-
 * shaped fix executor. Consumes the same `{file_path, line_start,
 * before_pattern, after_pattern}` row contract `buildDiffJson` emits and
 * either previews (dry-run) or applies (Slice 2) the edits to disk.
 *
 * Slice 1 ships phase-1 validation + dry-run output only; the write branch
 * (phase 2) lands in Slice 2 with atomic temp-rename. See
 * [`docs/plans/codemap-apply.md`](../../docs/plans/codemap-apply.md) for the
 * full design (Q1–Q10 locked).
 *
 * TOCTOU note: phase-1 reads disk, phase-2 writes disk. The window between
 * is a deliberate v1 simplification (Q2) — apply isn't an adversarial verb,
 * so we don't add lock-file machinery.
 */

import { readFileSync } from "node:fs";
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
  /** `true` previews; `false` writes (Slice 2). */
  dryRun: boolean;
}

/**
 * Per-file roll-up. `rows_applied` is `0` in dry-run (Slice 1) and `0` in
 * apply mode when phase 1 collected any conflicts (Q2 (c) — all-or-nothing
 * per recipe-run aborts before any writes).
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
 * is gated on `!dryRun && conflicts.length === 0` and lands in Slice 2.
 */
export function applyDiffPayload(opts: ApplyDiffPayloadOpts): ApplyJsonPayload {
  const { rows, projectRoot, dryRun } = opts;

  // Phase 1: validate every row against current disk state.
  const conflicts: ConflictRow[] = [];
  const pending = new Map<string, PendingEdit[]>();
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

    let source: string;
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

  // Phase 2 (write) lands in Slice 2. Every code path below is dry-run-shaped.
  if (!dryRun && conflicts.length === 0 && pending.size > 0) {
    throw new Error(
      "apply-engine: write path lands in Slice 2 — pass dryRun: true for now.",
    );
  }

  // Q2 (c) — any conflict aborts the whole run; `files[]` shows nothing
  // applied. Dry-run mirrors that shape so the envelope is the same across
  // modes.
  const files: ApplyFile[] =
    conflicts.length === 0
      ? [...pending.keys()].sort().map((file_path) => ({
          file_path,
          rows_applied: 0,
        }))
      : [];

  const filesWithConflicts = new Set(conflicts.map((c) => c.file_path)).size;
  const distinctInputFiles = new Set<string>();
  for (const row of rows) {
    const filePath = readString(row, "file_path");
    if (filePath !== undefined) distinctInputFiles.add(filePath);
  }

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
