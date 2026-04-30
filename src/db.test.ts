import { describe, expect, it } from "bun:test";

import {
  closeDb,
  createIndexes,
  createTables,
  getMeta,
  getAllFileHashes,
  insertFile,
  insertSymbols,
  SCHEMA_VERSION,
  setMeta,
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
});
