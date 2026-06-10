import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDb, createSchema, insertFile } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { ingestChurnFromJsonFile } from "./ingest-churn-run";

describe("ingestChurnFromJsonFile", () => {
  it("loads indexed paths and skips unindexed rows", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-ingest-churn-"));
    try {
      const jsonPath = join(root, "churn.json");
      writeFileSync(
        jsonPath,
        JSON.stringify([
          {
            file_path: "src/a.ts",
            commit_count: 5,
            weighted_commits: 4,
            lines_added: 10,
            lines_removed: 2,
            last_commit_at: "2026-06-01T00:00:00Z",
            churn_trend: "stable",
            computed_at: "2026-06-10T00:00:00Z",
          },
          {
            file_path: "src/missing.ts",
            commit_count: 1,
            weighted_commits: 1,
            lines_added: 1,
            lines_removed: 0,
            last_commit_at: null,
            churn_trend: null,
            computed_at: "2026-06-10T00:00:00Z",
          },
        ]),
      );

      const db = openCodemapDatabase(":memory:");
      try {
        createSchema(db);
        insertFile(db, {
          path: "src/a.ts",
          content_hash: "a",
          size: 10,
          line_count: 1,
          language: "typescript",
          last_modified: 1,
          indexed_at: 1,
        });
        const result = ingestChurnFromJsonFile(db, {
          projectRoot: root,
          path: "churn.json",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.ingested).toBe(1);
        expect(result.skipped_unindexed).toBe(1);
        const n = db
          .query<{ c: number }>("SELECT COUNT(*) AS c FROM file_churn")
          .get()?.c;
        expect(n).toBe(1);
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects empty JSON without wiping file_churn", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-ingest-churn-empty-"));
    try {
      const jsonPath = join(root, "empty.json");
      writeFileSync(jsonPath, "[]");
      const db = openCodemapDatabase(":memory:");
      try {
        createSchema(db);
        insertFile(db, {
          path: "src/a.ts",
          content_hash: "a",
          size: 10,
          line_count: 1,
          language: "typescript",
          last_modified: 1,
          indexed_at: 1,
        });
        const result = ingestChurnFromJsonFile(db, {
          projectRoot: root,
          path: "empty.json",
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toContain("at least one row");
        const n = db
          .query<{ c: number }>("SELECT COUNT(*) AS c FROM file_churn")
          .get()?.c;
        expect(n).toBe(0);
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
