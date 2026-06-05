import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
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
import { closeDb, createTables, insertFile, openDb } from "../db";
import { upsertQueryBaseline } from "../db";
import { initCodemap } from "../runtime";
import {
  handleApply,
  handleApplyDiffInput,
  handleApplyRows,
  handleContext,
  handleIngestCoverage,
  handleQuery,
  handleQueryRecipe,
  handleShow,
  handleSnippet,
} from "./tool-handlers";

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

describe("handleQuery baseline", () => {
  it("diffs against a saved baseline", () => {
    const db = openDb();
    try {
      upsertQueryBaseline(db, {
        name: "pre",
        recipe_id: null,
        sql: "SELECT name FROM symbols",
        rows_json: JSON.stringify([]),
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });
    } finally {
      closeDb(db);
    }
    const result = handleQuery(
      {
        sql: "SELECT name FROM symbols",
        baseline: "pre",
        summary: true,
      },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      baseline: { name: "pre" },
      added: 1,
      removed: 0,
    });
  });

  it("rejects baseline + format=sarif", () => {
    const result = handleQuery(
      { sql: "SELECT 1", baseline: "pre", format: "sarif" },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("cannot be combined with format=sarif"),
    });
  });

  it("rejects baseline + group_by", () => {
    const result = handleQuery(
      { sql: "SELECT 1", baseline: "pre", group_by: "directory" },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("cannot be combined with group_by"),
    });
  });

  it("returns 404 for missing baseline", () => {
    const result = handleQuery(
      { sql: "SELECT 1", baseline: "missing-baseline" },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: expect.stringContaining('no baseline named "missing-baseline"'),
    });
  });

  it("returns 400 for corrupt baseline rows_json", () => {
    const db = openDb();
    try {
      upsertQueryBaseline(db, {
        name: "bad",
        recipe_id: null,
        sql: "SELECT 1",
        rows_json: "not-json",
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });
    } finally {
      closeDb(db);
    }
    const result = handleQuery(
      { sql: "SELECT 1", baseline: "bad" },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("corrupt rows_json"),
    });
  });
});

describe("handleQueryRecipe baseline", () => {
  it("diffs recipe rows with actions on added", () => {
    const db = openDb();
    try {
      upsertQueryBaseline(db, {
        name: "funcs",
        recipe_id: "find-symbol-by-kind",
        sql: "SELECT name FROM symbols WHERE kind = 'function'",
        rows_json: JSON.stringify([]),
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });
    } finally {
      closeDb(db);
    }
    const result = handleQueryRecipe(
      {
        recipe: "find-symbol-by-kind",
        params: { kind: "function", name_pattern: "%Query%" },
        baseline: "funcs",
      },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as {
      added: Array<{ name: string; actions?: unknown[] }>;
    };
    expect(payload.added).toHaveLength(1);
    expect(payload.added[0]?.actions?.[0]).toMatchObject({
      type: "inspect-symbols",
    });
  });

  it("returns 404 for missing baseline", () => {
    const result = handleQueryRecipe(
      {
        recipe: "find-symbol-by-kind",
        params: { kind: "function", name_pattern: "%Query%" },
        baseline: "missing-baseline",
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: expect.stringContaining('no baseline named "missing-baseline"'),
    });
  });

  it("rejects baseline + group_by", () => {
    const result = handleQueryRecipe(
      {
        recipe: "find-symbol-by-kind",
        baseline: "funcs",
        group_by: "directory",
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("cannot be combined with group_by"),
    });
  });
});

describe("handleIngestCoverage", () => {
  it("returns error when path is missing on disk", async () => {
    const result = await handleIngestCoverage(
      { path: "no-such/coverage-final.json" },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("path not found"),
    });
  });

  it("ingests istanbul artifact successfully", async () => {
    const db = openDb();
    try {
      insertFile(db, {
        path: "src/lib/cache.ts",
        content_hash: "h2",
        size: 1,
        line_count: 100,
        language: "typescript",
        last_modified: 0,
        indexed_at: 0,
      });
      db.run(
        "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name, visibility, complexity) VALUES ('src/lib/cache.ts', 'get', 'function', 9, 15, 'get(): void', 1, 0, NULL, NULL, NULL, NULL, NULL, 1)",
      );
    } finally {
      closeDb(db);
    }

    const coverageDir = join(projectRoot, "coverage");
    mkdirSync(coverageDir);
    writeFileSync(
      join(coverageDir, "coverage-final.json"),
      JSON.stringify({
        [`${projectRoot}/src/lib/cache.ts`]: {
          path: `${projectRoot}/src/lib/cache.ts`,
          statementMap: {
            "0": {
              start: { line: 10, column: 0 },
              end: { line: 10, column: 1 },
            },
          },
          s: { "0": 1 },
        },
      }),
    );

    const result = await handleIngestCoverage(
      { path: "coverage/coverage-final.json" },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      format: "istanbul",
      ingested: { symbols: 1 },
    });
  });

  it("ingests v8 runtime directory when runtime is true", async () => {
    const db = openDb();
    try {
      insertFile(db, {
        path: "src/lib/cache.ts",
        content_hash: "h2",
        size: 1,
        line_count: 3,
        language: "typescript",
        last_modified: 0,
        indexed_at: 0,
      });
      db.run(
        "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name, visibility, complexity) VALUES ('src/lib/cache.ts', 'get', 'function', 1, 3, 'get(): void', 1, 0, NULL, NULL, NULL, NULL, NULL, 1)",
      );
    } finally {
      closeDb(db);
    }

    const source = "export function get() {\n  return 1;\n}\n";
    mkdirSync(join(projectRoot, "src/lib"), { recursive: true });
    writeFileSync(join(projectRoot, "src/lib/cache.ts"), source);
    const dir = join(projectRoot, "v8-runtime");
    mkdirSync(dir);
    const { pathToFileURL } = await import("node:url");
    writeFileSync(
      join(dir, "coverage-1.json"),
      JSON.stringify({
        result: [
          {
            scriptId: "1",
            url: pathToFileURL(
              join(projectRoot, "src/lib/cache.ts"),
            ).toString(),
            functions: [
              {
                functionName: "get",
                isBlockCoverage: true,
                ranges: [
                  { startOffset: 0, endOffset: source.length, count: 1 },
                ],
              },
            ],
          },
        ],
      }),
    );

    const result = await handleIngestCoverage(
      { path: "v8-runtime", runtime: true },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      format: "v8",
      ingested: { symbols: 1 },
    });
  });

  it("returns error for malformed istanbul JSON", async () => {
    const coverageDir = join(projectRoot, "coverage");
    mkdirSync(coverageDir);
    writeFileSync(join(coverageDir, "coverage-final.json"), "{not-json");

    const result = await handleIngestCoverage(
      { path: "coverage/coverage-final.json" },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.any(String),
    });
  });
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

describe("handleShow / handleSnippet — field-qualified query", () => {
  it("show query zero-match returns {matches:[]} not error", () => {
    const result = handleShow({ query: "name:NoSuchSymbol" }, projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({ matches: [] });
  });

  it("show with_fts on empty source_fts returns warning", () => {
    const result = handleShow(
      { query: "freeTextToken", with_fts: true },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const payload = result.payload as { matches: unknown[]; warning?: string };
    expect(payload.matches).toEqual([]);
    expect(payload.warning).toContain("source_fts is empty");
  });

  it("snippet query zero-match returns {matches:[]} not error", () => {
    const result = handleSnippet({ query: "name:NoSuchSymbol" }, projectRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toEqual({ matches: [] });
  });
});

describe("handleApply", () => {
  it("returns 404 for an unknown recipe", async () => {
    const result = await handleApply(
      { recipe: "no-such-recipe-id", dry_run: true },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      error: expect.stringContaining("unknown recipe"),
    });
  });

  it("rejects a write request without yes (Q6 — non-TTY transports)", async () => {
    const result = await handleApply(
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

  it("rejects dry_run + yes as mutually exclusive", async () => {
    const result = await handleApply(
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

  it("returns the dry-run envelope shape on a parametrised recipe", async () => {
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
    const result = await handleApply(
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

  it("writes disk when yes: true on an auto_fixable recipe", async () => {
    const realRoot = realpathSync(projectRoot);
    writeFileSync(
      join(realRoot, "src", "query.ts"),
      "export function runQuery() {}\n",
      "utf8",
    );
    const result = await handleApply(
      {
        recipe: "rename-preview",
        params: { old: "runQuery", new: "runQry", kind: "function" },
        yes: true,
      },
      realRoot,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({ mode: "apply", applied: true });
      expect(readFileSync(join(realRoot, "src", "query.ts"), "utf8")).toBe(
        "export function runQry() {}\n",
      );
    }
  });

  it("rejects yes without force when recipe is not auto_fixable", async () => {
    const result = await handleApply(
      {
        recipe: "add-jsdoc-deprecated",
        params: {
          name: "runQuery",
          replacement: "Use runQry instead.",
        },
        yes: true,
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("auto_fixable"),
    });
  });

  it("returns fixpoint envelope fields on until_empty dry_run", async () => {
    writeFileSync(
      join(projectRoot, "src", "marked.ts"),
      "// FIXME: todo item\nexport const MARKED = 1;\n",
      "utf8",
    );
    const db = openDb();
    try {
      insertFile(db, {
        path: "src/marked.ts",
        content_hash: "h-marked",
        size: 40,
        line_count: 2,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      db.run(
        `INSERT INTO markers (file_path, line_number, kind, content)
         VALUES ('src/marked.ts', 1, 'FIXME', 'todo item')`,
      );
    } finally {
      closeDb(db);
    }
    const result = await handleApply(
      {
        recipe: "replace-marker-kind",
        params: { from_kind: "FIXME", to_kind: "XXX" },
        dry_run: true,
        until_empty: true,
        max_passes: 2,
      },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as {
        passes?: number;
        terminated_by?: string;
      };
      expect(payload.passes).toBeGreaterThanOrEqual(1);
      expect(payload.terminated_by).toBeDefined();
    }
  });
});

describe("handleApplyRows", () => {
  it("rejects a write request without yes", async () => {
    const result = await handleApplyRows(
      {
        rows: [
          {
            file_path: "src/query.ts",
            line_start: 1,
            before_pattern: "runQuery",
            after_pattern: "runQry",
          },
        ],
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("yes: true"),
    });
  });

  it("returns dry-run envelope for explicit rows", async () => {
    writeFileSync(
      join(projectRoot, "src", "query.ts"),
      "export function runQuery() {}\n",
      "utf8",
    );
    const result = await handleApplyRows(
      {
        rows: [
          {
            file_path: "src/query.ts",
            line_start: 1,
            before_pattern: "runQuery",
            after_pattern: "runQry",
          },
        ],
        dry_run: true,
      },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({
        mode: "dry-run",
        applied: false,
      });
    }
  });

  it("writes disk when yes: true", async () => {
    writeFileSync(
      join(projectRoot, "src", "query.ts"),
      "export function runQuery() {}\n",
      "utf8",
    );
    const result = await handleApplyRows(
      {
        rows: [
          {
            file_path: "src/query.ts",
            line_start: 1,
            before_pattern: "runQuery",
            after_pattern: "runQry",
          },
        ],
        yes: true,
      },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(readFileSync(join(projectRoot, "src", "query.ts"), "utf8")).toBe(
        "export function runQry() {}\n",
      );
    }
  });
});

describe("handleApply commit_message", () => {
  beforeEach(() => {
    execSync("git init", { cwd: projectRoot, stdio: "ignore" });
    execSync("git config user.email test@codemap.test", {
      cwd: projectRoot,
      stdio: "ignore",
    });
    execSync("git config user.name Codemap Test", {
      cwd: projectRoot,
      stdio: "ignore",
    });
    execSync("git add -A", { cwd: projectRoot, stdio: "ignore" });
    execSync('git commit -m "initial"', {
      cwd: projectRoot,
      stdio: "ignore",
    });
  });

  it("commits after recipe apply when commit_message is set", async () => {
    const realRoot = realpathSync(projectRoot);
    writeFileSync(
      join(realRoot, "src", "query.ts"),
      "export function runQuery() {}\n",
      "utf8",
    );
    const result = await handleApply(
      {
        recipe: "rename-preview",
        params: { old: "runQuery", new: "runQry", kind: "function" },
        yes: true,
        commit_message: "chore: rename via MCP handler",
      },
      realRoot,
    );
    expect(result.ok).toBe(true);
    const log = execSync("git log --oneline", {
      cwd: realRoot,
      encoding: "utf8",
    });
    expect(log).toContain("chore: rename via MCP handler");
  });
});

describe("handleApplyDiffInput", () => {
  it("rejects a write request without yes", async () => {
    const result = await handleApplyDiffInput(
      {
        diff_text: `--- a/src/query.ts
+++ b/src/query.ts
@@ -1,1 +1,1 @@
-runQuery
+runQry
`,
      },
      projectRoot,
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("yes: true"),
    });
  });

  it("returns dry-run envelope for unified diff text", async () => {
    writeFileSync(
      join(projectRoot, "src", "query.ts"),
      "export function runQuery() {}\n",
      "utf8",
    );
    const result = await handleApplyDiffInput(
      {
        diff_text: `diff --git a/src/query.ts b/src/query.ts
--- a/src/query.ts
+++ b/src/query.ts
@@ -1,1 +1,1 @@
-export function runQuery() {}
+export function runQry() {}
`,
        dry_run: true,
      },
      projectRoot,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({
        mode: "dry-run",
        applied: false,
      });
    }
  });
});

describe("handleContext", () => {
  it("returns the bootstrap envelope with start_here", () => {
    const result = handleContext({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as Record<string, unknown>;
      expect(payload.start_here).toBeDefined();
      expect(payload.codemap).toMatchObject({
        schema_version: expect.any(Number),
      });
    }
  });

  it("treats whitespace-only intent as no intent", () => {
    const result = handleContext({ intent: "   " });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as {
        start_here?: { classified_as: string };
        intent?: unknown;
      };
      expect(payload.start_here?.classified_as).toBe("default");
      expect(payload.intent).toBeUndefined();
    }
  });

  it("omits start_here when compact even with include_snippets", () => {
    const result = handleContext({ compact: true, include_snippets: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const payload = result.payload as Record<string, unknown>;
      expect(payload.start_here).toBeUndefined();
      expect(payload.hubs).toBeUndefined();
    }
  });
});
