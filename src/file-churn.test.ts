import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  closeDb,
  createSchema,
  insertFile,
  insertFileChurn,
  replaceFileChurn,
} from "./db";
import type { FileChurnRow } from "./db";
import { openCodemapDatabase } from "./sqlite-db";

const REPO_ROOT = join(import.meta.dir, "..");

describe("file_churn + churn-complexity-hotspots recipe", () => {
  it("ranks files by weighted_commits × max complexity", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/hot.ts",
        content_hash: "a",
        size: 100,
        line_count: 10,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      insertFile(db, {
        path: "src/cold.ts",
        content_hash: "b",
        size: 50,
        line_count: 5,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      const churn: FileChurnRow[] = [
        {
          file_path: "src/hot.ts",
          commit_count: 20,
          weighted_commits: 15,
          lines_added: 200,
          lines_removed: 50,
          last_commit_at: "2026-06-01T00:00:00Z",
          churn_trend: "accelerating",
          computed_at: "2026-06-10T00:00:00Z",
        },
        {
          file_path: "src/cold.ts",
          commit_count: 2,
          weighted_commits: 1,
          lines_added: 10,
          lines_removed: 2,
          last_commit_at: "2026-01-01T00:00:00Z",
          churn_trend: "cooling",
          computed_at: "2026-06-10T00:00:00Z",
        },
      ];
      replaceFileChurn(db, churn);
      db.run(
        `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name, visibility, name_column_start, name_column_end, scope_local_id, body_line_count, param_count, complexity)
         VALUES ('src/hot.ts', 'hotFn', 'function', 1, 5, 'hotFn()', 1, 0, NULL, NULL, NULL, NULL, NULL, 1, 4, 0, 5, 0, 12),
                ('src/cold.ts', 'coldFn', 'function', 1, 3, 'coldFn()', 1, 0, NULL, NULL, NULL, NULL, NULL, 1, 5, 0, 3, 0, 3)`,
      );

      const sql = readFileSync(
        join(REPO_ROOT, "templates/recipes/churn-complexity-hotspots.sql"),
        "utf-8",
      );
      const rows = db.query(sql).all(20, 1, 0) as Array<{
        file_path: string;
        hotspot_score: number;
        hotspot_score_normalized: number;
        symbol_name: string | null;
      }>;
      expect(rows.length).toBe(2);
      expect(rows[0]?.file_path).toBe("src/hot.ts");
      expect(rows[0]?.hotspot_score).toBe(180);
      expect(rows[0]?.hotspot_score_normalized).toBe(100);
      expect(rows[0]?.symbol_name).toBeNull();
      expect(rows[1]?.file_path).toBe("src/cold.ts");
      expect(rows[1]?.hotspot_score).toBe(3);
      expect(rows[1]?.hotspot_score_normalized).toBe(1.7);
    } finally {
      closeDb(db);
    }
  });

  it("replaceFileChurn clears prior rows", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/x.ts",
        content_hash: "x",
        size: 10,
        line_count: 1,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      insertFileChurn(db, [
        {
          file_path: "src/x.ts",
          commit_count: 1,
          weighted_commits: 1,
          lines_added: 1,
          lines_removed: 0,
          last_commit_at: null,
          churn_trend: null,
          computed_at: "2026-06-10T00:00:00Z",
        },
      ]);
      replaceFileChurn(db, []);
      const count = db
        .query<{ n: number }>("SELECT COUNT(*) AS n FROM file_churn")
        .get();
      expect(count?.n).toBe(0);
    } finally {
      closeDb(db);
    }
  });
});
