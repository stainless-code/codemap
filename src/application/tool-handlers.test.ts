import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import { handleQueryRecipe } from "./tool-handlers";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "tool-handlers-"));
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  initCodemap(resolveCodemapConfig(projectRoot, undefined));
  const db = openDb();
  try {
    createTables(db);
    db.run(
      "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/query.ts', 'h1', 10, 1, 'typescript', 1, 1)",
    );
    db.run(
      "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name, visibility, complexity) VALUES ('src/query.ts', 'runQuery', 'function', 1, 1, 'runQuery()', 1, 0, NULL, NULL, NULL, NULL, NULL, 1)",
    );
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("handleQueryRecipe params", () => {
  it("binds nested params object for query_recipe", () => {
    const result = handleQueryRecipe(
      {
        recipe: "find-symbol-by-kind",
        params: { kind: "function", name_pattern: "%Query%" },
      },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toEqual([
        {
          name: "runQuery",
          kind: "function",
          file_path: "src/query.ts",
          line_start: 1,
          signature: "runQuery()",
          actions: [
            {
              type: "inspect-symbols",
              description:
                "Review matching symbols and narrow with kind / name_pattern if needed.",
            },
          ],
        },
      ]);
    }
  });

  it("returns validation error for missing required params", () => {
    const result = handleQueryRecipe(
      {
        recipe: "find-symbol-by-kind",
        params: { kind: "function" },
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('missing required param "name_pattern"'),
    });
  });
});
