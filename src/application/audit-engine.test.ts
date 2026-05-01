import { describe, expect, it } from "bun:test";

import { createTables, insertFile, upsertQueryBaseline } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { computeDelta, runAudit, V1_DELTAS } from "./audit-engine";

function freshDb(): CodemapDatabase {
  const db = openCodemapDatabase(":memory:");
  createTables(db);
  return db;
}

function seedFile(db: CodemapDatabase, path: string) {
  insertFile(db, {
    path,
    content_hash: "h",
    size: 1,
    line_count: 1,
    language: "ts",
    last_modified: 0,
    indexed_at: 0,
  });
}

const filesSpec = V1_DELTAS.find((d) => d.key === "files")!;

describe("runAudit (engine)", () => {
  it("returns an error envelope when the named baseline doesn't exist", () => {
    const db = freshDb();
    try {
      const result = runAudit({ db, baselineName: "missing" });
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain('no baseline named "missing"');
      }
    } finally {
      db.close();
    }
  });

  it("emits {base, head, deltas} when baseline matches all delta contracts", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      seedFile(db, "src/b.ts");
      upsertQueryBaseline(db, {
        name: "pre-refactor",
        recipe_id: null,
        sql: "SELECT path FROM files",
        rows_json: JSON.stringify([{ path: "src/a.ts" }, { path: "src/b.ts" }]),
        row_count: 2,
        git_ref: "abc1234",
        created_at: 1_700_000_000_000,
      });

      const result = runAudit({ db, baselineName: "pre-refactor" });
      if ("error" in result)
        throw new Error(`unexpected error: ${result.error}`);

      expect(result.base).toEqual({
        source: "baseline",
        name: "pre-refactor",
        sha: "abc1234",
        indexed_at: 1_700_000_000_000,
      });
      expect(result.head.indexed_at).toBeGreaterThan(0);
      expect(result.deltas).toHaveProperty("files");
      expect(result.deltas.files).toEqual({ added: [], removed: [] });
    } finally {
      db.close();
    }
  });

  it("propagates a delta error envelope when one baseline doesn't match a delta contract", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      upsertQueryBaseline(db, {
        name: "wrong-shape",
        recipe_id: null,
        sql: "SELECT name FROM symbols",
        rows_json: JSON.stringify([{ name: "Foo" }]),
        row_count: 1,
        git_ref: null,
        created_at: 1_700_000_000_000,
      });

      const result = runAudit({ db, baselineName: "wrong-shape" });
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain("missing required columns");
        expect(result.error).toContain('delta "files"');
      }
    } finally {
      db.close();
    }
  });
});

describe("computeDelta — files", () => {
  it("returns no diff when baseline equals current", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      const result = computeDelta(db, "x", [{ path: "src/a.ts" }], filesSpec);
      expect(result).toEqual({ added: [], removed: [] });
    } finally {
      db.close();
    }
  });

  it("reports added rows when current has files baseline didn't", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      seedFile(db, "src/b.ts");
      const result = computeDelta(db, "x", [{ path: "src/a.ts" }], filesSpec);
      expect(result).toEqual({ added: [{ path: "src/b.ts" }], removed: [] });
    } finally {
      db.close();
    }
  });

  it("reports removed rows when baseline had files current doesn't", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      const result = computeDelta(
        db,
        "x",
        [{ path: "src/a.ts" }, { path: "src/gone.ts" }],
        filesSpec,
      );
      expect(result).toEqual({ added: [], removed: [{ path: "src/gone.ts" }] });
    } finally {
      db.close();
    }
  });

  it("projects extra baseline columns away (schema-drift-resilient)", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      // Baseline saved from `--recipe files-hashes` returns extra columns
      // (content_hash, language, line_count). Delta projects down to `path`
      // before diffing — so adding columns to the underlying table later
      // (e.g. SCHEMA_VERSION 4 → 5 added symbols.visibility) doesn't break
      // pre-bump baselines.
      const result = computeDelta(
        db,
        "x",
        [
          {
            path: "src/a.ts",
            content_hash: "old-hash",
            language: "ts",
            line_count: 99,
          },
        ],
        filesSpec,
      );
      expect(result).toEqual({ added: [], removed: [] });
    } finally {
      db.close();
    }
  });

  it("errors when baseline rows are missing the required columns", () => {
    const db = freshDb();
    try {
      const result = computeDelta(
        db,
        "wrong-shape",
        [{ name: "src/a.ts" }],
        filesSpec,
      );
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain('"wrong-shape"');
        expect(result.error).toContain("missing required columns");
        expect(result.error).toContain('delta "files"');
        expect(result.error).toContain("[name]");
        expect(result.error).toContain("[path]");
        expect(result.error).toContain(
          "codemap query --save-baseline=wrong-shape",
        );
      }
    } finally {
      db.close();
    }
  });

  it("treats empty baseline as 'every live row is added' (no validation needed)", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/new.ts");
      const result = computeDelta(db, "empty-baseline", [], filesSpec);
      expect(result).toEqual({ added: [{ path: "src/new.ts" }], removed: [] });
    } finally {
      db.close();
    }
  });
});
