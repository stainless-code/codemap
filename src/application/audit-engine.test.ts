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

function saveFilesBaseline(
  db: CodemapDatabase,
  name: string,
  paths: string[],
  gitRef: string | null = "abc1234",
  createdAt = 1_700_000_000_000,
) {
  upsertQueryBaseline(db, {
    name,
    recipe_id: null,
    sql: "SELECT path FROM files",
    rows_json: JSON.stringify(paths.map((p) => ({ path: p }))),
    row_count: paths.length,
    git_ref: gitRef,
    created_at: createdAt,
  });
}

const filesSpec = V1_DELTAS.find((d) => d.key === "files")!;

describe("runAudit (engine)", () => {
  it("returns an error envelope when the baselines map is empty", () => {
    const db = freshDb();
    try {
      const result = runAudit({ db, baselines: {} });
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain("no delta baselines provided");
      }
    } finally {
      db.close();
    }
  });

  it("returns an error envelope when an explicit baseline doesn't exist", () => {
    const db = freshDb();
    try {
      const result = runAudit({
        db,
        baselines: { files: "missing" },
      });
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain('no baseline named "missing"');
        expect(result.error).toContain('delta "files"');
      }
    } finally {
      db.close();
    }
  });

  it("runs only the requested deltas (others are absent from the envelope)", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      saveFilesBaseline(db, "files-snap", ["src/a.ts"]);

      const result = runAudit({
        db,
        baselines: { files: "files-snap" },
      });
      if ("error" in result)
        throw new Error(`unexpected error: ${result.error}`);

      expect(Object.keys(result.deltas)).toEqual(["files"]);
      expect(result.deltas.files).toMatchObject({
        base: {
          source: "baseline",
          name: "files-snap",
          sha: "abc1234",
          indexed_at: 1_700_000_000_000,
        },
        added: [],
        removed: [],
      });
      expect(result.head.indexed_at).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("each delta carries its own base metadata (mixed-baseline support)", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      saveFilesBaseline(
        db,
        "files-snap-yesterday",
        ["src/a.ts"],
        "yesterday-sha",
        1_700_000_000_000,
      );
      saveFilesBaseline(
        db,
        "files-snap-today",
        ["src/a.ts", "src/b.ts"],
        "today-sha",
        1_700_000_001_000,
      );

      const r1 = runAudit({
        db,
        baselines: { files: "files-snap-yesterday" },
      });
      const r2 = runAudit({
        db,
        baselines: { files: "files-snap-today" },
      });

      if ("error" in r1 || "error" in r2) throw new Error("unexpected error");
      const r1Base = r1.deltas.files!.base;
      const r2Base = r2.deltas.files!.base;
      if (r1Base.source !== "baseline" || r2Base.source !== "baseline") {
        throw new Error("expected baseline-source bases");
      }
      expect(r1Base.name).toBe("files-snap-yesterday");
      expect(r1Base.sha).toBe("yesterday-sha");
      expect(r2Base.name).toBe("files-snap-today");
      expect(r2Base.sha).toBe("today-sha");
    } finally {
      db.close();
    }
  });

  it("rejects a baseline whose rows_json parses to non-array (null)", () => {
    const db = freshDb();
    try {
      upsertQueryBaseline(db, {
        name: "null-rows",
        recipe_id: null,
        sql: "SELECT 1",
        rows_json: "null",
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });
      const result = runAudit({ db, baselines: { files: "null-rows" } });
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain('"null-rows"');
        expect(result.error).toContain("invalid rows_json");
        expect(result.error).toContain("null");
      }
    } finally {
      db.close();
    }
  });

  it("rejects a baseline whose rows_json parses to non-array (object)", () => {
    const db = freshDb();
    try {
      upsertQueryBaseline(db, {
        name: "object-rows",
        recipe_id: null,
        sql: "SELECT 1",
        rows_json: "{}",
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });
      const result = runAudit({ db, baselines: { files: "object-rows" } });
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain("invalid rows_json");
        expect(result.error).toContain("object");
      }
    } finally {
      db.close();
    }
  });

  it("propagates a column-mismatch error from a delta", () => {
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

      const result = runAudit({
        db,
        baselines: { files: "wrong-shape" },
      });
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
