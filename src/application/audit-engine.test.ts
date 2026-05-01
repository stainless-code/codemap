import { describe, expect, it } from "bun:test";

import { createTables, upsertQueryBaseline } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { runAudit } from "./audit-engine";

describe("runAudit (engine)", () => {
  it("returns an error envelope when the named baseline doesn't exist", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      const result = runAudit({ db, baselineName: "missing" });
      expect(result).toHaveProperty("error");
      if ("error" in result) {
        expect(result.error).toContain('no baseline named "missing"');
      }
    } finally {
      db.close();
    }
  });

  it("emits the {base, head, deltas} envelope when the baseline exists", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      upsertQueryBaseline(db, {
        name: "pre-refactor",
        recipe_id: null,
        sql: "SELECT path FROM files",
        rows_json: "[]",
        row_count: 0,
        git_ref: "abc1234",
        created_at: 1_700_000_000_000,
      });

      const result = runAudit({ db, baselineName: "pre-refactor" });
      expect("error" in result).toBe(false);
      if ("error" in result) return;

      expect(result.base).toEqual({
        source: "baseline",
        name: "pre-refactor",
        sha: "abc1234",
        indexed_at: 1_700_000_000_000,
      });
      expect(result.head.indexed_at).toBeGreaterThan(0);
      // Tracer 1: deltas object is empty until tracer 2+ fills it.
      expect(result.deltas).toEqual({});
    } finally {
      db.close();
    }
  });
});
