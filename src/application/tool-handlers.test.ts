import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import { handleApply, handleQueryRecipe } from "./tool-handlers";

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

describe("handleApply", () => {
  it("returns 404 for an unknown recipe", () => {
    const result = handleApply(
      { recipe: "no-such-recipe-id", dry_run: true },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: expect.stringContaining("unknown recipe"),
    });
  });

  it("rejects a write request without yes (Q6 — non-TTY transports)", () => {
    const result = handleApply(
      {
        recipe: "rename-preview",
        params: { old: "runQuery", new: "runQry" },
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("yes: true"),
    });
  });

  it("rejects dry_run + yes as mutually exclusive", () => {
    const result = handleApply(
      {
        recipe: "rename-preview",
        params: { old: "runQuery", new: "runQry" },
        dry_run: true,
        yes: true,
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("mutually exclusive"),
    });
  });

  it("returns the dry-run envelope shape on a parametrised recipe", () => {
    // Realpath the project root so oxc-resolver's symlink-derefed
    // resolved_path aligns with the indexed file paths (mirrors the
    // CLI integration test).
    const realRoot = realpathSync(projectRoot);
    // Write the actual source file the indexed symbol points at so
    // phase-1 can read it when the recipe row resolves.
    writeFileSync(
      join(realRoot, "src", "query.ts"),
      "export function runQuery() {}\n",
      "utf8",
    );
    const result = handleApply(
      {
        recipe: "rename-preview",
        params: { old: "runQuery", new: "runQry", kind: "function" },
        dry_run: true,
      },
      realRoot,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as Record<string, unknown>;
      expect(payload.mode).toBe("dry-run");
      expect(payload.applied).toBe(false);
      expect(payload.summary).toMatchObject({
        rows: 1,
        rows_applied: 0,
      });
      // Disk untouched.
      expect(readFileSync(join(realRoot, "src", "query.ts"), "utf8")).toBe(
        "export function runQuery() {}\n",
      );
    }
  });
});
