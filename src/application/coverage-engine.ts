import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { CodemapDatabase } from "../db";
import { toProjectRelative } from "./validate-engine";

/**
 * One coverage data point — a single executable statement after the parser
 * front-end (Istanbul or LCOV) has normalised its source format. The engine
 * is format-agnostic from this point on.
 *
 * `line` is the source-text line where the statement begins (1-indexed,
 * matches `symbols.line_start`). `hit_count` is the number of times the
 * statement was executed; `0` means uncovered.
 */
export interface CoverageRow {
  file_path: string;
  line: number;
  hit_count: number;
}

/** Source format detected by the CLI auto-detector. */
export type CoverageFormat = "istanbul" | "lcov" | "v8";

export interface IngestResult {
  ingested: { symbols: number; files: number };
  skipped: { unmatched_files: number; statements_no_symbol: number };
  pruned_orphans: number;
  format: CoverageFormat;
}

interface UpsertOpts {
  db: CodemapDatabase;
  projectRoot: string;
  rows: CoverageRow[];
  format: CoverageFormat;
  /** Absolute path of the source artifact, recorded in `meta` for freshness checks. */
  sourcePath: string;
}

/**
 * Format-agnostic write path. Maps every {@link CoverageRow} to the innermost
 * enclosing symbol via the natural-key projection (D7), aggregates per
 * `(file_path, name, line_start)`, upserts into `coverage`, writes the three
 * `coverage_last_ingested_*` meta keys, and runs the orphan-cleanup DELETE.
 *
 * Pure with respect to filesystem and process state — every side effect is a
 * `db.run` against the in-memory or on-disk SQLite handle the caller passed.
 */
export function upsertCoverageRows(opts: UpsertOpts): IngestResult {
  const { db, projectRoot, rows, format, sourcePath } = opts;

  // Normalise paths once up-front. Istanbul writes absolute paths;
  // toProjectRelative reuses the same projection validate-engine ships (D8).
  // Drop rows whose normalised path escapes the project root (relative path
  // would start with `..`) — they get tracked in `skipped.unmatched_files`.
  const filesSeen = new Set<string>();
  const filesUnmatched = new Set<string>();
  const normalised: CoverageRow[] = [];
  for (const row of rows) {
    const rel = toProjectRelative(projectRoot, row.file_path);
    if (rel.startsWith("..")) {
      filesUnmatched.add(row.file_path);
      continue;
    }
    normalised.push({ ...row, file_path: rel });
    filesSeen.add(rel);
  }

  // Inner aggregator: (file_path, name, line_start) → {hit, total}.
  // Using a string key keeps the aggregation O(1) per row without spilling
  // to a nested Map.
  interface SymbolBucket {
    file_path: string;
    name: string;
    line_start: number;
    hit_statements: number;
    total_statements: number;
  }
  const buckets = new Map<string, SymbolBucket>();

  // Per-file projection cache: symbols of one file are looked up once and
  // walked in JS for the innermost-wins selection. Avoids a per-statement
  // SQL round-trip (the hot path called out in the plan's perf notes) and
  // also lets us implement the tie-break locally.
  interface SymbolRange {
    name: string;
    line_start: number;
    line_end: number;
    /** `line_end - line_start`; primary sort key for innermost-wins (D7). */
    span: number;
  }
  const symbolsByFile = new Map<string, SymbolRange[]>();

  function loadSymbols(file_path: string): SymbolRange[] {
    let cached = symbolsByFile.get(file_path);
    if (cached) return cached;
    cached = (
      db
        .query<{ name: string; line_start: number; line_end: number }>(
          `SELECT name, line_start, line_end FROM symbols WHERE file_path = ? ORDER BY line_start ASC`,
        )
        .all(file_path) ?? []
    ).map((r) => ({
      name: r.name,
      line_start: r.line_start,
      line_end: r.line_end,
      span: r.line_end - r.line_start,
    }));
    symbolsByFile.set(file_path, cached);
    return cached;
  }

  let statementsNoSymbol = 0;
  for (const row of normalised) {
    const symbols = loadSymbols(row.file_path);
    let best: SymbolRange | undefined;
    for (const sym of symbols) {
      if (sym.line_start > row.line) break; // ORDER BY line_start ASC: nothing further can enclose
      if (sym.line_end < row.line) continue;
      if (!best || sym.span < best.span) best = sym;
    }
    if (!best) {
      statementsNoSymbol++;
      continue;
    }
    const key = `${row.file_path}\u0000${best.name}\u0000${best.line_start}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        file_path: row.file_path,
        name: best.name,
        line_start: best.line_start,
        hit_statements: 0,
        total_statements: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.total_statements++;
    if (row.hit_count > 0) bucket.hit_statements++;
  }

  // Single transaction: clear every existing coverage row for the files
  // we're ingesting (a re-ingest is a full replace per file, not a merge),
  // then bulk-insert the new aggregates. Idempotent across re-runs.
  let pruned = 0;
  db.run("BEGIN");
  try {
    for (const file_path of filesSeen) {
      db.run("DELETE FROM coverage WHERE file_path = ?", [file_path]);
    }
    for (const bucket of buckets.values()) {
      // total = 0 → coverage_pct NULL (D5 edge); "untested" and "no testable
      // code" are different signals — never collapse to 0.
      const pct =
        bucket.total_statements > 0
          ? (bucket.hit_statements / bucket.total_statements) * 100
          : null;
      db.run(
        `INSERT INTO coverage
          (file_path, name, line_start, coverage_pct, hit_statements, total_statements)
          VALUES (?, ?, ?, ?, ?, ?)`,
        [
          bucket.file_path,
          bucket.name,
          bucket.line_start,
          pct,
          bucket.hit_statements,
          bucket.total_statements,
        ],
      );
    }

    // Orphan cleanup (D6) — files that no longer exist in the project drop
    // their coverage rows. Lives at the end of every ingest so the
    // natural-key trade-off (no FK / CASCADE) doesn't accumulate dead rows.
    const beforeOrphans = (
      db.query<{ n: number }>("SELECT COUNT(*) AS n FROM coverage").get() as {
        n: number;
      }
    ).n;
    db.run(
      "DELETE FROM coverage WHERE file_path NOT IN (SELECT path FROM files)",
    );
    const afterOrphans = (
      db.query<{ n: number }>("SELECT COUNT(*) AS n FROM coverage").get() as {
        n: number;
      }
    ).n;
    pruned = beforeOrphans - afterOrphans;

    // Meta keys (single ingest at a time, so per-row `source` would be
    // denormalisation noise — D plan).
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      "coverage_last_ingested_at",
      String(Date.now()),
    ]);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      "coverage_last_ingested_path",
      sourcePath,
    ]);
    db.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", [
      "coverage_last_ingested_format",
      format,
    ]);

    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  }

  return {
    ingested: { symbols: buckets.size, files: filesSeen.size },
    skipped: {
      unmatched_files: filesUnmatched.size,
      statements_no_symbol: statementsNoSymbol,
    },
    pruned_orphans: pruned,
    format,
  };
}

/* ------------------------------------------------------------------ */
/* Istanbul JSON parser                                                */
/* ------------------------------------------------------------------ */

/**
 * Subset of Istanbul's `coverage-final.json` shape we read. Everything we
 * don't need (fnMap / branchMap / inputSourceMap / hash) is left untyped
 * so the file format can grow without churning this signature.
 *
 * Statement counts (`s`) are keyed by the same string indices as
 * `statementMap`; each value is the times-executed count for that statement.
 */
export interface IstanbulFileCoverage {
  path?: string;
  statementMap: Record<string, IstanbulLocation>;
  s: Record<string, number>;
}

interface IstanbulLocation {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

export type IstanbulPayload = Record<string, IstanbulFileCoverage>;

interface ParserOpts {
  db: CodemapDatabase;
  projectRoot: string;
  payload: IstanbulPayload;
  /** Absolute path the CLI read the JSON from; threaded into `meta`. */
  sourcePath: string;
}

/**
 * Parse an Istanbul payload and dispatch to {@link upsertCoverageRows}. The
 * Istanbul shape is keyed by absolute file path; the inner `path` field
 * (when present) takes precedence over the key (handles webpack-style
 * symlinked paths).
 */
export function ingestIstanbul(opts: ParserOpts): IngestResult {
  const { payload, sourcePath, ...rest } = opts;
  const rows: CoverageRow[] = [];
  for (const [absPath, file] of Object.entries(payload)) {
    if (!file?.statementMap || !file?.s) continue; // tolerate malformed entries
    const file_path = file.path ?? absPath;
    for (const [stmtId, location] of Object.entries(file.statementMap)) {
      const hit = file.s[stmtId];
      if (hit === undefined) continue;
      rows.push({
        file_path,
        line: location.start.line,
        hit_count: hit,
      });
    }
  }
  return upsertCoverageRows({
    ...rest,
    rows,
    format: "istanbul",
    sourcePath,
  });
}

/* ------------------------------------------------------------------ */
/* LCOV parser                                                         */
/* ------------------------------------------------------------------ */

interface LcovParserOpts {
  db: CodemapDatabase;
  projectRoot: string;
  /** Raw LCOV text (read by the CLI from `lcov.info`). */
  payload: string;
  sourcePath: string;
}

/**
 * Parse an LCOV record stream and dispatch to {@link upsertCoverageRows}.
 *
 * Recognised lines (everything else — `TN:` / `FN:` / `FNDA:` / `FNF:` /
 * `FNH:` / `BRDA:` / `BRF:` / `BRH:` / `LF:` / `LH:` — is ignored; we only
 * need statement coverage in v1 per D5):
 * - `SF:<path>` — start of a file record; sets the "current file"
 * - `DA:<line>,<exec_count>[,<checksum>]` — one statement per record
 * - `end_of_record` — closes the current file record
 *
 * Throws when a `DA:` line appears outside an `SF:` block (malformed
 * LCOV — the file would have nowhere to attach to). Missing
 * `end_of_record` is tolerated (the last block flushes implicitly when
 * the next `SF:` arrives or the input ends).
 */
export function ingestLcov(opts: LcovParserOpts): IngestResult {
  const { payload, sourcePath, ...rest } = opts;
  const rows: CoverageRow[] = [];
  let currentFile: string | undefined;
  let lineNumber = 0;
  for (const rawLine of payload.split(/\r?\n/)) {
    lineNumber++;
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    if (line.startsWith("SF:")) {
      currentFile = line.slice(3);
      continue;
    }
    if (line === "end_of_record") {
      currentFile = undefined;
      continue;
    }
    if (line.startsWith("DA:")) {
      if (!currentFile) {
        throw new Error(
          `LCOV parse error at line ${lineNumber}: DA: record outside SF: block`,
        );
      }
      // DA:<line>,<count>[,<checksum>]
      const parts = line.slice(3).split(",");
      const lineNum = Number.parseInt(parts[0] ?? "", 10);
      const hitCount = Number.parseInt(parts[1] ?? "", 10);
      if (!Number.isFinite(lineNum) || !Number.isFinite(hitCount)) continue;
      rows.push({
        file_path: currentFile,
        line: lineNum,
        hit_count: hitCount,
      });
    }
    // Everything else (TN:, FN:, BRDA:, etc.) silently skipped per D5.
  }
  return upsertCoverageRows({
    ...rest,
    rows,
    format: "lcov",
    sourcePath,
  });
}

/* ------------------------------------------------------------------ */
/* V8 runtime coverage parser                                          */
/* ------------------------------------------------------------------ */

/**
 * Subset of V8's coverage protocol shape (`NODE_V8_COVERAGE=...` per-process dump).
 * `ranges` carry byte offsets, NOT lines; with `isBlockCoverage: true` the outer
 * range is function-level and inner ranges are nested basic blocks.
 */
export interface V8FunctionCoverage {
  functionName: string;
  isBlockCoverage: boolean;
  ranges: Array<{
    startOffset: number;
    endOffset: number;
    count: number;
  }>;
}

export interface V8ScriptCoverage {
  scriptId: string;
  url: string;
  functions: V8FunctionCoverage[];
}

export interface V8CoveragePayload {
  result: V8ScriptCoverage[];
}

interface V8ParserOpts {
  db: CodemapDatabase;
  projectRoot: string;
  /** All `result` entries merged from every `coverage-*.json` in the dir. */
  scripts: V8ScriptCoverage[];
  /** Absolute path of the directory; threaded into `meta`. */
  sourcePath: string;
}

/**
 * Parse merged V8 ScriptCoverage entries and dispatch to {@link upsertCoverageRows}.
 * Per-line hit counts: walk each function's ranges largest→smallest, last write
 * wins → innermost-wins semantics matching V8's documented model.
 */
export function ingestV8(opts: V8ParserOpts): IngestResult {
  const { scripts, sourcePath, ...rest } = opts;
  const rows: CoverageRow[] = [];

  // Group by URL so duplicate dumps (multi-process test run) merge before
  // emit; otherwise upsert would inflate `total_statements`.
  const scriptsByUrl = new Map<string, V8ScriptCoverage[]>();
  for (const script of scripts) {
    if (!script?.url) continue;
    // V8 reports `node:internal/...`, `evalmachine.<anonymous>`, etc.
    if (!script.url.startsWith("file://")) continue;
    const list = scriptsByUrl.get(script.url) ?? [];
    list.push(script);
    scriptsByUrl.set(script.url, list);
  }

  for (const [url, urlScripts] of scriptsByUrl) {
    let absPath: string;
    try {
      absPath = fileURLToPath(url);
    } catch {
      continue;
    }
    let source: string;
    try {
      source = readFileSync(absPath, "utf-8");
    } catch {
      // File deleted between test run and ingest; upsertCoverageRows would
      // also surface this as `unmatched_files` if we'd let it through.
      continue;
    }

    const lineOffsets = buildLineOffsets(source);
    const lineHits: (number | undefined)[] = new Array(lineOffsets.length + 1);

    for (const script of urlScripts) {
      for (const fn of script.functions ?? []) {
        const sorted = (fn.ranges ?? [])
          .slice()
          .sort(
            (a, b) =>
              b.endOffset - b.startOffset - (a.endOffset - a.startOffset),
          );
        for (const range of sorted) {
          const startLine = offsetToLine(lineOffsets, range.startOffset);
          const endLine = offsetToLine(lineOffsets, range.endOffset);
          for (let line = startLine; line <= endLine; line++) {
            // Innermost-wins: last write here is from the smallest range.
            lineHits[line] = range.count;
          }
        }
      }
    }

    for (let line = 1; line < lineHits.length; line++) {
      const hit = lineHits[line];
      if (hit === undefined) continue;
      rows.push({ file_path: absPath, line, hit_count: hit });
    }
  }

  return upsertCoverageRows({
    ...rest,
    rows,
    format: "v8",
    sourcePath,
  });
}

/**
 * `offsets[i]` = byte offset of line `i + 1` start. Approximation: we walk
 * char codes (UTF-16) not bytes, so a multi-byte char before column 0
 * shifts subsequent offsets by 1; acceptable for line-resolution coverage.
 */
function buildLineOffsets(source: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) offsets.push(i + 1);
  }
  return offsets;
}

/** Binary search → 1-indexed line containing `offset`. */
function offsetToLine(lineOffsets: number[], offset: number): number {
  let lo = 0;
  let hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (lineOffsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
