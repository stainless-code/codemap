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
export type CoverageFormat = "istanbul" | "lcov";

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
