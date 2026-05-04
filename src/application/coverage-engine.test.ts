import { describe, expect, it } from "bun:test";

import {
  closeDb,
  createIndexes,
  createTables,
  insertFile,
  insertSymbols,
} from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import {
  ingestIstanbul,
  ingestLcov,
  upsertCoverageRows,
} from "./coverage-engine";
import type { IstanbulPayload } from "./coverage-engine";

const PROJECT_ROOT = "/repo";

function setupDb() {
  const db = openCodemapDatabase(":memory:");
  createTables(db);
  createIndexes(db);
  return db;
}

function indexedFile(path: string) {
  return {
    path,
    content_hash: `h-${path}`,
    size: 1,
    line_count: 100,
    language: "ts" as const,
    last_modified: 0,
    indexed_at: 0,
  };
}

function fnSym(
  file_path: string,
  name: string,
  line_start: number,
  line_end: number,
) {
  return {
    file_path,
    name,
    kind: "function",
    line_start,
    line_end,
    signature: `${name}(): void`,
    is_exported: 1,
    is_default_export: 0,
    members: null,
    doc_comment: null,
    value: null,
    parent_name: null,
    visibility: null,
  };
}

describe("coverage-engine", () => {
  describe("upsertCoverageRows (shared core)", () => {
    it("aggregates statements per innermost symbol and computes pct", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertSymbols(db, [
          fnSym("a.ts", "outer", 1, 20),
          fnSym("a.ts", "inner", 5, 10),
        ]);
        const result = upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul",
          sourcePath: "/repo/coverage/coverage-final.json",
          rows: [
            { file_path: "a.ts", line: 2, hit_count: 1 }, // outer only
            { file_path: "a.ts", line: 6, hit_count: 1 }, // inner (innermost)
            { file_path: "a.ts", line: 7, hit_count: 0 }, // inner, miss
            { file_path: "a.ts", line: 15, hit_count: 1 }, // outer (after inner range)
          ],
        });
        expect(result.ingested).toEqual({ symbols: 2, files: 1 });
        expect(result.skipped.statements_no_symbol).toBe(0);

        const rows = db
          .query(
            "SELECT name, hit_statements, total_statements, coverage_pct FROM coverage ORDER BY name",
          )
          .all() as Array<{
          name: string;
          hit_statements: number;
          total_statements: number;
          coverage_pct: number | null;
        }>;
        // inner: 1 hit / 2 stmts = 50%; outer: 2 hits / 2 stmts = 100%
        // (outer's range covers lines 5-10 too, but innermost-wins gave them to inner).
        expect(rows).toEqual([
          {
            name: "inner",
            hit_statements: 1,
            total_statements: 2,
            coverage_pct: 50,
          },
          {
            name: "outer",
            hit_statements: 2,
            total_statements: 2,
            coverage_pct: 100,
          },
        ]);
      } finally {
        closeDb(db);
      }
    });

    it("statement outside every symbol increments skipped.statements_no_symbol", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertSymbols(db, [fnSym("a.ts", "fn", 10, 20)]);
        const result = upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul",
          sourcePath: "/repo/coverage-final.json",
          rows: [
            { file_path: "a.ts", line: 1, hit_count: 1 }, // top-level expr
            { file_path: "a.ts", line: 2, hit_count: 0 }, // side-effect import
            { file_path: "a.ts", line: 15, hit_count: 1 }, // inside fn
          ],
        });
        expect(result.skipped.statements_no_symbol).toBe(2);
        expect(result.ingested.symbols).toBe(1);
      } finally {
        closeDb(db);
      }
    });

    it("symbol with zero statements gets no row (NULL via LEFT JOIN)", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertSymbols(db, [
          fnSym("a.ts", "ifaceLike", 1, 5), // no statements project here
          fnSym("a.ts", "fn", 10, 20),
        ]);
        upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul",
          sourcePath: "/x",
          rows: [{ file_path: "a.ts", line: 12, hit_count: 1 }],
        });
        const names = (
          db.query("SELECT name FROM coverage ORDER BY name").all() as Array<{
            name: string;
          }>
        ).map((r) => r.name);
        expect(names).toEqual(["fn"]);
      } finally {
        closeDb(db);
      }
    });

    it("re-ingest replaces per-file rows (UPSERT idempotence)", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertSymbols(db, [fnSym("a.ts", "fn", 1, 10)]);
        const opts = {
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul" as const,
          sourcePath: "/x",
        };
        upsertCoverageRows({
          ...opts,
          rows: [{ file_path: "a.ts", line: 2, hit_count: 0 }],
        });
        upsertCoverageRows({
          ...opts,
          rows: [{ file_path: "a.ts", line: 2, hit_count: 5 }],
        });
        const row = db
          .query("SELECT hit_statements, coverage_pct FROM coverage")
          .get() as { hit_statements: number; coverage_pct: number };
        expect(row).toEqual({ hit_statements: 1, coverage_pct: 100 });
      } finally {
        closeDb(db);
      }
    });

    it("orphan cleanup drops rows whose file no longer exists", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertFile(db, indexedFile("b.ts"));
        insertSymbols(db, [
          fnSym("a.ts", "fnA", 1, 5),
          fnSym("b.ts", "fnB", 1, 5),
        ]);
        upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul",
          sourcePath: "/x",
          rows: [
            { file_path: "a.ts", line: 2, hit_count: 1 },
            { file_path: "b.ts", line: 2, hit_count: 1 },
          ],
        });
        // Simulate "b.ts deleted between ingests" by removing the files row.
        db.run("DELETE FROM files WHERE path = ?", ["b.ts"]);
        const result = upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul",
          sourcePath: "/x",
          rows: [{ file_path: "a.ts", line: 2, hit_count: 1 }],
        });
        expect(result.pruned_orphans).toBe(1);
        const paths = (
          db.query("SELECT file_path FROM coverage").all() as Array<{
            file_path: string;
          }>
        ).map((r) => r.file_path);
        expect(paths).toEqual(["a.ts"]);
      } finally {
        closeDb(db);
      }
    });

    it("file outside project root → skipped.unmatched_files", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertSymbols(db, [fnSym("a.ts", "fn", 1, 5)]);
        const result = upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul",
          sourcePath: "/x",
          rows: [
            { file_path: "/elsewhere/x.ts", line: 1, hit_count: 1 },
            { file_path: "a.ts", line: 2, hit_count: 1 },
          ],
        });
        expect(result.skipped.unmatched_files).toBe(1);
        expect(result.ingested.files).toBe(1);
      } finally {
        closeDb(db);
      }
    });

    it("writes the three coverage_last_ingested_* meta keys", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertSymbols(db, [fnSym("a.ts", "fn", 1, 5)]);
        upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "lcov",
          sourcePath: "/repo/coverage/lcov.info",
          rows: [{ file_path: "a.ts", line: 2, hit_count: 1 }],
        });
        const meta = db
          .query<{ key: string; value: string }>(
            "SELECT key, value FROM meta WHERE key LIKE 'coverage_last_%' ORDER BY key",
          )
          .all() as Array<{ key: string; value: string }>;
        expect(meta.map((m) => m.key)).toEqual([
          "coverage_last_ingested_at",
          "coverage_last_ingested_format",
          "coverage_last_ingested_path",
        ]);
        const map = Object.fromEntries(meta.map((m) => [m.key, m.value]));
        expect(map.coverage_last_ingested_format).toBe("lcov");
        expect(map.coverage_last_ingested_path).toBe(
          "/repo/coverage/lcov.info",
        );
        expect(Number(map.coverage_last_ingested_at)).toBeGreaterThan(0);
      } finally {
        closeDb(db);
      }
    });

    it("normalises absolute paths to project-relative", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("src/api/client.ts"));
        insertSymbols(db, [fnSym("src/api/client.ts", "fn", 1, 5)]);
        upsertCoverageRows({
          db,
          projectRoot: PROJECT_ROOT,
          format: "istanbul",
          sourcePath: "/x",
          rows: [
            { file_path: "/repo/src/api/client.ts", line: 2, hit_count: 1 },
          ],
        });
        const path = (
          db.query("SELECT file_path FROM coverage").get() as {
            file_path: string;
          }
        ).file_path;
        expect(path).toBe("src/api/client.ts");
      } finally {
        closeDb(db);
      }
    });
  });

  describe("ingestIstanbul (parser)", () => {
    it("parses a real-shape Istanbul payload end-to-end", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("src/lib/cache.ts"));
        insertSymbols(db, [
          fnSym("src/lib/cache.ts", "get", 9, 15),
          fnSym("src/lib/cache.ts", "invalidate", 17, 23),
        ]);
        const payload: IstanbulPayload = {
          "/repo/src/lib/cache.ts": {
            path: "/repo/src/lib/cache.ts",
            statementMap: {
              "0": {
                start: { line: 10, column: 0 },
                end: { line: 10, column: 1 },
              },
              "1": {
                start: { line: 11, column: 0 },
                end: { line: 11, column: 1 },
              },
              "2": {
                start: { line: 18, column: 0 },
                end: { line: 18, column: 1 },
              },
            },
            s: { "0": 5, "1": 0, "2": 1 },
          },
        };
        const result = ingestIstanbul({
          db,
          projectRoot: PROJECT_ROOT,
          payload,
          sourcePath: "/repo/coverage/coverage-final.json",
        });
        expect(result).toMatchObject({
          ingested: { symbols: 2, files: 1 },
          format: "istanbul",
        });
        const rows = db
          .query(
            "SELECT name, hit_statements, total_statements FROM coverage ORDER BY name",
          )
          .all() as Array<{
          name: string;
          hit_statements: number;
          total_statements: number;
        }>;
        expect(rows).toEqual([
          { name: "get", hit_statements: 1, total_statements: 2 },
          { name: "invalidate", hit_statements: 1, total_statements: 1 },
        ]);
      } finally {
        closeDb(db);
      }
    });

    it("Istanbul + LCOV produce identical rows for equivalent inputs (cross-format equivalence)", () => {
      const istanbulDb = setupDb();
      const lcovDb = setupDb();
      try {
        for (const db of [istanbulDb, lcovDb]) {
          insertFile(db, indexedFile("src/lib/cache.ts"));
          insertSymbols(db, [fnSym("src/lib/cache.ts", "get", 9, 15)]);
        }
        ingestIstanbul({
          db: istanbulDb,
          projectRoot: PROJECT_ROOT,
          sourcePath: "/repo/coverage-final.json",
          payload: {
            "/repo/src/lib/cache.ts": {
              path: "/repo/src/lib/cache.ts",
              statementMap: {
                "0": {
                  start: { line: 10, column: 0 },
                  end: { line: 10, column: 1 },
                },
                "1": {
                  start: { line: 11, column: 0 },
                  end: { line: 11, column: 1 },
                },
              },
              s: { "0": 5, "1": 0 },
            },
          },
        });
        ingestLcov({
          db: lcovDb,
          projectRoot: PROJECT_ROOT,
          sourcePath: "/repo/lcov.info",
          payload: [
            "TN:",
            "SF:/repo/src/lib/cache.ts",
            "DA:10,5",
            "DA:11,0",
            "end_of_record",
            "",
          ].join("\n"),
        });
        const cols =
          "file_path, name, line_start, hit_statements, total_statements, coverage_pct";
        const istanbulRows = istanbulDb
          .query(`SELECT ${cols} FROM coverage`)
          .all();
        const lcovRows = lcovDb.query(`SELECT ${cols} FROM coverage`).all();
        expect(lcovRows).toEqual(istanbulRows);
      } finally {
        closeDb(istanbulDb);
        closeDb(lcovDb);
      }
    });

    it("tolerates malformed file entries (missing statementMap or s)", () => {
      const db = setupDb();
      try {
        insertFile(db, indexedFile("a.ts"));
        insertSymbols(db, [fnSym("a.ts", "fn", 1, 5)]);
        const result = ingestIstanbul({
          db,
          projectRoot: PROJECT_ROOT,
          sourcePath: "/x",
          payload: {
            "/repo/a.ts": {
              statementMap: {
                "0": {
                  start: { line: 2, column: 0 },
                  end: { line: 2, column: 1 },
                },
              },
              s: { "0": 1 },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            "/repo/broken.ts": { path: "/repo/broken.ts" } as any,
          },
        });
        expect(result.ingested.symbols).toBe(1);
      } finally {
        closeDb(db);
      }
    });
  });

  describe("ingestLcov (parser)", () => {
    function lcovDb() {
      const db = setupDb();
      insertFile(db, indexedFile("src/api/client.ts"));
      insertSymbols(db, [
        fnSym("src/api/client.ts", "fetchUser", 5, 12),
        fnSym("src/api/client.ts", "fetchPosts", 14, 20),
      ]);
      return db;
    }

    it("parses well-formed LCOV with multiple SF records", () => {
      const db = lcovDb();
      try {
        const lcov = [
          "TN:",
          "SF:/repo/src/api/client.ts",
          "FN:5,fetchUser",
          "FN:14,fetchPosts",
          "DA:6,3",
          "DA:7,3",
          "DA:15,0",
          "DA:16,0",
          "LF:4",
          "LH:2",
          "end_of_record",
          "",
        ].join("\n");
        const result = ingestLcov({
          db,
          projectRoot: PROJECT_ROOT,
          sourcePath: "/repo/lcov.info",
          payload: lcov,
        });
        expect(result.format).toBe("lcov");
        expect(result.ingested).toEqual({ symbols: 2, files: 1 });
        const rows = db
          .query(
            "SELECT name, hit_statements, total_statements, coverage_pct FROM coverage ORDER BY name",
          )
          .all() as Array<{
          name: string;
          hit_statements: number;
          total_statements: number;
          coverage_pct: number;
        }>;
        expect(rows).toEqual([
          {
            name: "fetchPosts",
            hit_statements: 0,
            total_statements: 2,
            coverage_pct: 0,
          },
          {
            name: "fetchUser",
            hit_statements: 2,
            total_statements: 2,
            coverage_pct: 100,
          },
        ]);
      } finally {
        closeDb(db);
      }
    });

    it("ignores TN/FN/FNDA/BRDA/LF/LH and supports CRLF + comments + blank lines", () => {
      const db = lcovDb();
      try {
        const lcov = [
          "# header comment",
          "TN:test-suite",
          "",
          "SF:/repo/src/api/client.ts",
          "FN:5,fetchUser",
          "FNDA:1,fetchUser",
          "FNF:1",
          "FNH:1",
          "DA:6,1",
          "BRDA:6,0,0,1",
          "BRF:1",
          "BRH:1",
          "LF:1",
          "LH:1",
          "end_of_record",
        ].join("\r\n");
        const result = ingestLcov({
          db,
          projectRoot: PROJECT_ROOT,
          sourcePath: "/x",
          payload: lcov,
        });
        expect(result.ingested.symbols).toBe(1);
      } finally {
        closeDb(db);
      }
    });

    it("DA: outside SF: block throws (malformed)", () => {
      const db = lcovDb();
      try {
        expect(() =>
          ingestLcov({
            db,
            projectRoot: PROJECT_ROOT,
            sourcePath: "/x",
            payload: "DA:1,1\n",
          }),
        ).toThrow(/DA: record outside SF: block/);
      } finally {
        closeDb(db);
      }
    });

    it("DA: with optional checksum (third comma-field) is parsed", () => {
      const db = lcovDb();
      try {
        const result = ingestLcov({
          db,
          projectRoot: PROJECT_ROOT,
          sourcePath: "/x",
          payload: [
            "SF:/repo/src/api/client.ts",
            "DA:6,3,abc1234checksum",
            "end_of_record",
          ].join("\n"),
        });
        expect(result.ingested.symbols).toBe(1);
      } finally {
        closeDb(db);
      }
    });
  });
});
