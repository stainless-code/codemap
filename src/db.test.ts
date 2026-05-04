import { describe, expect, it } from "bun:test";

import {
  closeDb,
  createIndexes,
  createTables,
  deleteQueryBaseline,
  dropAll,
  getMeta,
  getAllFileHashes,
  getQueryBaseline,
  insertFile,
  insertSymbols,
  listQueryBaselines,
  SCHEMA_VERSION,
  setMeta,
  upsertQueryBaseline,
} from "./db";
import { openCodemapDatabase } from "./sqlite-db";

describe("SQLite layer (in-memory)", () => {
  it("creates schema and round-trips meta", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      setMeta(db, "schema_version", String(SCHEMA_VERSION));
      expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
      expect(getMeta(db, "missing")).toBeUndefined();
    } finally {
      closeDb(db);
    }
  });

  it("getAllFileHashes is empty on fresh DB", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      expect(getAllFileHashes(db).size).toBe(0);
    } finally {
      closeDb(db);
    }
  });

  it("symbols.visibility round-trips with index hit on WHERE visibility = ?", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      createIndexes(db);
      insertFile(db, {
        path: "x.ts",
        content_hash: "abc",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertSymbols(db, [
        {
          file_path: "x.ts",
          name: "publicFn",
          kind: "function",
          line_start: 1,
          line_end: 1,
          signature: "publicFn(): void",
          is_exported: 1,
          is_default_export: 0,
          members: null,
          doc_comment: "@public",
          value: null,
          parent_name: null,
          visibility: "public",
        },
        {
          file_path: "x.ts",
          name: "internalFn",
          kind: "function",
          line_start: 2,
          line_end: 2,
          signature: "internalFn(): void",
          is_exported: 1,
          is_default_export: 0,
          members: null,
          doc_comment: "@internal",
          value: null,
          parent_name: null,
          visibility: "internal",
        },
        {
          file_path: "x.ts",
          name: "plain",
          kind: "function",
          line_start: 3,
          line_end: 3,
          signature: "plain(): void",
          is_exported: 1,
          is_default_export: 0,
          members: null,
          doc_comment: null,
          value: null,
          parent_name: null,
          visibility: null,
        },
      ]);

      const rows = db
        .query("SELECT name, visibility FROM symbols ORDER BY name")
        .all() as Array<{ name: string; visibility: string | null }>;
      expect(rows).toEqual([
        { name: "internalFn", visibility: "internal" },
        { name: "plain", visibility: null },
        { name: "publicFn", visibility: "public" },
      ]);

      const tagged = db
        .query(
          "SELECT name FROM symbols WHERE visibility IS NOT NULL ORDER BY name",
        )
        .all() as Array<{ name: string }>;
      expect(tagged.map((r) => r.name)).toEqual(["internalFn", "publicFn"]);
    } finally {
      closeDb(db);
    }
  });

  it("query_baselines round-trips upsert / get / list / delete", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      expect(listQueryBaselines(db)).toEqual([]);
      expect(getQueryBaseline(db, "fan-out")).toBeUndefined();

      upsertQueryBaseline(db, {
        name: "fan-out",
        recipe_id: "fan-out",
        sql: "SELECT 1",
        rows_json: JSON.stringify([{ a: 1 }, { a: 2 }]),
        row_count: 2,
        git_ref: "abc1234",
        created_at: 1_700_000_000_000,
      });

      const got = getQueryBaseline(db, "fan-out");
      expect(got).toEqual({
        name: "fan-out",
        recipe_id: "fan-out",
        sql: "SELECT 1",
        rows_json: JSON.stringify([{ a: 1 }, { a: 2 }]),
        row_count: 2,
        git_ref: "abc1234",
        created_at: 1_700_000_000_000,
      });

      // Re-saving with the same name overwrites in place.
      upsertQueryBaseline(db, {
        name: "fan-out",
        recipe_id: "fan-out",
        sql: "SELECT 1",
        rows_json: JSON.stringify([{ a: 1 }]),
        row_count: 1,
        git_ref: "def5678",
        created_at: 1_700_000_001_000,
      });
      expect(getQueryBaseline(db, "fan-out")?.row_count).toBe(1);
      expect(getQueryBaseline(db, "fan-out")?.git_ref).toBe("def5678");

      // Second baseline coexists.
      upsertQueryBaseline(db, {
        name: "pre-refactor",
        recipe_id: null,
        sql: "SELECT name FROM symbols",
        rows_json: "[]",
        row_count: 0,
        git_ref: null,
        created_at: 1_700_000_002_000,
      });

      const list = listQueryBaselines(db);
      // Sorted DESC by created_at — pre-refactor first.
      expect(list.map((b) => b.name)).toEqual(["pre-refactor", "fan-out"]);
      expect(list[0]).not.toHaveProperty("rows_json"); // summary view omits payload

      expect(deleteQueryBaseline(db, "pre-refactor")).toBe(true);
      expect(deleteQueryBaseline(db, "pre-refactor")).toBe(false); // already gone
      expect(listQueryBaselines(db).map((b) => b.name)).toEqual(["fan-out"]);
    } finally {
      closeDb(db);
    }
  });

  it("coverage table round-trips, survives dropAll(), and orphan sweep removes deleted-file rows", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      createIndexes(db);

      // Two files; the second will be deleted to exercise the orphan-cleanup
      // DELETE that lives in application/coverage-engine.ts (D6).
      for (const path of ["a.ts", "b.ts"]) {
        insertFile(db, {
          path,
          content_hash: `h-${path}`,
          size: 1,
          line_count: 1,
          language: "ts",
          last_modified: 0,
          indexed_at: 0,
        });
      }

      // Natural-key insert (no FK to symbols.id; D6).
      db.run(
        `INSERT INTO coverage (file_path, name, line_start, coverage_pct, hit_statements, total_statements)
         VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`,
        [
          "a.ts",
          "fnA",
          1,
          100.0,
          3,
          3,
          "a.ts",
          "fnB",
          5,
          50.0,
          1,
          2,
          "b.ts",
          "fnC",
          1,
          null,
          0,
          0, // total = 0 → coverage_pct NULL (D5 edge)
        ],
      );

      const rows = db
        .query(
          "SELECT file_path, name, coverage_pct FROM coverage ORDER BY file_path, line_start",
        )
        .all() as Array<{
        file_path: string;
        name: string;
        coverage_pct: number | null;
      }>;
      expect(rows).toEqual([
        { file_path: "a.ts", name: "fnA", coverage_pct: 100.0 },
        { file_path: "a.ts", name: "fnB", coverage_pct: 50.0 },
        { file_path: "b.ts", name: "fnC", coverage_pct: null },
      ]);

      // dropAll() drops symbols + indices + every CASCADE-bearing table; the
      // headline contract for coverage (D6) is that user rows survive that path.
      dropAll(db);
      createTables(db);
      createIndexes(db);
      expect(
        (db.query("SELECT COUNT(*) AS n FROM coverage").get() as { n: number })
          .n,
      ).toBe(3);

      // After --full reindex, files would normally be re-inserted by the
      // indexer. Simulate "b.ts was deleted from the project before re-index"
      // by re-inserting only a.ts.
      insertFile(db, {
        path: "a.ts",
        content_hash: "h-a.ts",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });

      // Orphan-cleanup DELETE — lives in application/coverage-engine.ts at the
      // end of every ingest. Exercised here so a future schema refactor can't
      // silently break the contract that motivated D6 (no FK / CASCADE).
      db.run(
        "DELETE FROM coverage WHERE file_path NOT IN (SELECT path FROM files)",
      );

      const remaining = db
        .query("SELECT file_path FROM coverage ORDER BY file_path, line_start")
        .all() as Array<{ file_path: string }>;
      expect(remaining.map((r) => r.file_path)).toEqual(["a.ts", "a.ts"]);
    } finally {
      closeDb(db);
    }
  });

  it("query_baselines survives dropAll() — the schema-rebuild contract", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      upsertQueryBaseline(db, {
        name: "fan-out",
        recipe_id: "fan-out",
        sql: "SELECT 1",
        rows_json: "[]",
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });

      // dropAll() is what `--full` and SCHEMA_VERSION-mismatch rebuilds invoke.
      // The headline contract of B.6 is that user baselines survive that path —
      // exercise it explicitly so a future schema refactor can't silently break it.
      dropAll(db);
      createTables(db);

      expect(listQueryBaselines(db).map((b) => b.name)).toEqual(["fan-out"]);
      expect(getQueryBaseline(db, "fan-out")?.recipe_id).toBe("fan-out");
    } finally {
      closeDb(db);
    }
  });
});
