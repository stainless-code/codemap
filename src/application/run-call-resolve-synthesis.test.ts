import { describe, expect, it } from "bun:test";

import { resolveCodemapConfig } from "../config";
import {
  closeDb,
  createSchema,
  deleteHeuristicCalls,
  insertCalls,
  insertFile,
} from "../db";
import type { CodemapDatabase } from "../db";
import { initCodemap } from "../runtime";
import { openCodemapDatabase } from "../sqlite-db";
import { runCallResolveAndSynthesis } from "./index-engine";

function seedHeuristicCall(db: CodemapDatabase) {
  insertFile(db, {
    path: "src/a.ts",
    content_hash: "h",
    size: 1,
    line_count: 1,
    language: "ts",
    last_modified: 0,
    indexed_at: 0,
  });
  insertCalls(db, [
    {
      file_path: "src/a.ts",
      caller_name: "A",
      caller_scope: "A",
      callee_name: "B",
      line_start: 1,
      column_start: 0,
      column_end: 1,
      provenance: "heuristic",
    },
  ]);
}

describe("runCallResolveAndSynthesis", () => {
  it("purges all heuristic rows index-wide when synthesis is disabled", () => {
    const root = "/tmp/codemap-run-call-resolve-off";
    initCodemap(
      resolveCodemapConfig(root, { synthesis: { heuristicCalls: false } }),
    );
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      seedHeuristicCall(db);
      runCallResolveAndSynthesis(db);
      const left = db
        .query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM calls WHERE provenance = 'heuristic'",
        )
        .get() as { n: number };
      expect(left.n).toBe(0);
    } finally {
      closeDb(db);
    }
  });

  it("scoped purge leaves heuristics outside scope when synthesis is on", () => {
    const root = "/tmp/codemap-run-call-resolve-on";
    initCodemap(
      resolveCodemapConfig(root, { synthesis: { heuristicCalls: true } }),
    );
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "a",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertFile(db, {
        path: "src/other.ts",
        content_hash: "o",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertCalls(db, [
        {
          file_path: "src/a.ts",
          caller_name: "A",
          caller_scope: "A",
          callee_name: "B",
          line_start: 1,
          column_start: 0,
          column_end: 1,
          provenance: "heuristic",
        },
        {
          file_path: "src/other.ts",
          caller_name: "O",
          caller_scope: "O",
          callee_name: "P",
          line_start: 1,
          column_start: 0,
          column_end: 1,
          provenance: "heuristic",
        },
      ]);
      deleteHeuristicCalls(db, ["src/a.ts"]);
      runCallResolveAndSynthesis(db, ["src/a.ts"]);
      const n = db
        .query<{ n: number }>(
          "SELECT COUNT(*) AS n FROM calls WHERE provenance = 'heuristic'",
        )
        .get() as { n: number };
      expect(n.n).toBe(1);
      const row = db
        .query<{ file_path: string }>(
          "SELECT file_path FROM calls WHERE provenance = 'heuristic'",
        )
        .get() as { file_path: string };
      expect(row.file_path).toBe("src/other.ts");
    } finally {
      closeDb(db);
    }
  });
});
