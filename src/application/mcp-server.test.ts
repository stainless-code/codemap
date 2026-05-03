import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb, upsertQueryBaseline } from "../db";
import { initCodemap } from "../runtime";
import { createMcpServer } from "./mcp-server";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "mcp-server-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  writeFileSync(join(benchDir, "src", "a.ts"), "export const A = 1;\n");
  initCodemap(resolveCodemapConfig(benchDir, undefined));
  const db = openDb();
  try {
    createTables(db);
    db.run(
      "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/a.ts', 'h1', 10, 1, 'typescript', 1, 1), ('src/b.ts', 'h2', 10, 1, 'typescript', 1, 1), ('docs/c.md', 'h3', 5, 1, 'markdown', 1, 1)",
    );
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
});

async function makeClient() {
  const server = createMcpServer({ version: "0.0.0-test", root: benchDir });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

function readJson(result: unknown): any {
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  const first = r.content?.[0];
  if (first?.type !== "text" || first.text === undefined) {
    throw new Error("expected text content");
  }
  return JSON.parse(first.text) as unknown;
}

describe("MCP server — query tool", () => {
  it("lists query and query_batch in tools/list", async () => {
    const { client, server } = await makeClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name).sort();
      expect(names).toContain("query");
      expect(names).toContain("query_batch");
    } finally {
      await server.close();
    }
  });

  it("query returns row array verbatim from CLI envelope shape", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query",
        arguments: { sql: "SELECT path FROM files ORDER BY path" },
      });
      expect(readJson(r)).toEqual([
        { path: "docs/c.md" },
        { path: "src/a.ts" },
        { path: "src/b.ts" },
      ]);
    } finally {
      await server.close();
    }
  });

  it("query honors summary flag", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query",
        arguments: { sql: "SELECT path FROM files", summary: true },
      });
      expect(readJson(r)).toEqual({ count: 3 });
    } finally {
      await server.close();
    }
  });

  it("query returns isError + {error} payload on bad SQL", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query",
        arguments: { sql: "SELECT * FROM nonexistent" },
      });
      expect((r as { isError?: boolean }).isError).toBe(true);
      expect(readJson(r)).toMatchObject({ error: expect.any(String) });
    } finally {
      await server.close();
    }
  });

  it("query format=sarif on ad-hoc SQL uses codemap.adhoc rule id", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query",
        arguments: {
          sql: "SELECT path AS file_path FROM files",
          format: "sarif",
        },
      });
      const doc = readJson(r);
      expect(doc.runs[0].tool.driver.rules[0].id).toBe("codemap.adhoc");
      expect(doc.runs[0].results.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });
});

describe("MCP server — query_batch tool", () => {
  it("runs N statements with batch-wide flag defaults", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_batch",
        arguments: {
          statements: [
            "SELECT path FROM files WHERE language='typescript' ORDER BY path",
            "SELECT path FROM files WHERE language='markdown'",
          ],
        },
      });
      const json = readJson(r);
      expect(json).toHaveLength(2);
      expect(json[0]).toEqual([{ path: "src/a.ts" }, { path: "src/b.ts" }]);
      expect(json[1]).toEqual([{ path: "docs/c.md" }]);
    } finally {
      await server.close();
    }
  });

  it("per-statement object overrides batch-wide flag", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_batch",
        arguments: {
          statements: [
            "SELECT path FROM files",
            { sql: "SELECT path FROM files", summary: true },
          ],
        },
      });
      const json = readJson(r);
      expect(Array.isArray(json[0])).toBe(true);
      expect(json[1]).toEqual({ count: 3 });
    } finally {
      await server.close();
    }
  });

  it("string-form items inherit batch-wide summary default", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_batch",
        arguments: {
          statements: ["SELECT path FROM files", "SELECT path FROM files"],
          summary: true,
        },
      });
      const json = readJson(r);
      expect(json).toEqual([{ count: 3 }, { count: 3 }]);
    } finally {
      await server.close();
    }
  });

  it("isolates changed_since failures per slot — siblings still succeed", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_batch",
        arguments: {
          statements: [
            // ref that doesn't exist anywhere — git lookup should fail
            {
              sql: "SELECT path FROM files",
              changed_since: "definitely-not-a-real-ref-xyz123",
            },
            "SELECT path FROM files WHERE language='markdown'",
          ],
        },
      });
      const json = readJson(r);
      expect(json).toHaveLength(2);
      expect(json[0]).toMatchObject({ error: expect.any(String) });
      // Sibling statement still ran despite slot 0's git failure.
      expect(json[1]).toEqual([{ path: "docs/c.md" }]);
    } finally {
      await server.close();
    }
  });

  it("isolates per-statement errors — siblings still succeed", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_batch",
        arguments: {
          statements: [
            "SELECT path FROM files WHERE language='markdown'",
            "SELECT * FROM nonexistent",
          ],
        },
      });
      const json = readJson(r);
      expect(json).toHaveLength(2);
      expect(json[0]).toEqual([{ path: "docs/c.md" }]);
      expect(json[1]).toMatchObject({ error: expect.any(String) });
    } finally {
      await server.close();
    }
  });
});

describe("MCP server — query_recipe tool", () => {
  it("lists query_recipe in tools/list", async () => {
    const { client, server } = await makeClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain("query_recipe");
    } finally {
      await server.close();
    }
  });

  it("returns isError for unknown recipe id", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_recipe",
        arguments: { recipe: "this-recipe-does-not-exist" },
      });
      expect((r as { isError?: boolean }).isError).toBe(true);
      expect(readJson(r)).toMatchObject({
        error: expect.stringContaining("this-recipe-does-not-exist"),
      });
    } finally {
      await server.close();
    }
  });

  it("attaches per-row recipe actions to output rows", async () => {
    // Seed a deprecated symbol so deprecated-symbols recipe returns it.
    const db = openDb();
    try {
      db.run(
        `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, doc_comment)
         VALUES ('src/a.ts', 'oldFn', 'function', 1, 5, 'function oldFn()', '/** @deprecated use newFn */')`,
      );
    } finally {
      closeDb(db);
    }

    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_recipe",
        arguments: { recipe: "deprecated-symbols" },
      });
      const json = readJson(r);
      expect(Array.isArray(json)).toBe(true);
      expect(json.length).toBeGreaterThan(0);
      // Every row carries the recipe's actions template.
      expect(json[0]).toMatchObject({
        name: "oldFn",
        actions: [{ type: "flag-caller" }],
      });
    } finally {
      await server.close();
    }
  });

  it("composes summary flag with recipe", async () => {
    const { client, server } = await makeClient();
    try {
      // No deprecated symbols seeded for this test instance — should yield {count: 0}.
      const r = await client.callTool({
        name: "query_recipe",
        arguments: { recipe: "deprecated-symbols", summary: true },
      });
      expect(readJson(r)).toEqual({ count: 0 });
    } finally {
      await server.close();
    }
  });

  it("returns a SARIF doc with format=sarif", async () => {
    const db = openDb();
    try {
      db.run(
        `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, doc_comment)
         VALUES ('src/a.ts', 'oldFn', 'function', 1, 5, 'function oldFn()', '/** @deprecated */')`,
      );
    } finally {
      closeDb(db);
    }
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_recipe",
        arguments: { recipe: "deprecated-symbols", format: "sarif" },
      });
      const doc = readJson(r);
      expect(doc.version).toBe("2.1.0");
      expect(doc.runs[0].tool.driver.rules[0].id).toBe(
        "codemap.deprecated-symbols",
      );
      expect(doc.runs[0].results).toHaveLength(1);
      expect(doc.runs[0].results[0].ruleId).toBe("codemap.deprecated-symbols");
    } finally {
      await server.close();
    }
  });

  it("returns annotation lines with format=annotations", async () => {
    const db = openDb();
    try {
      db.run(
        `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, doc_comment)
         VALUES ('src/a.ts', 'oldFn', 'function', 7, 10, 'function oldFn()', '/** @deprecated */')`,
      );
    } finally {
      closeDb(db);
    }
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_recipe",
        arguments: { recipe: "deprecated-symbols", format: "annotations" },
      });
      const text = (r as { content: { text: string }[] }).content[0]!.text;
      expect(text).toMatch(/^::notice file=src\/a\.ts,line=7::oldFn/);
    } finally {
      await server.close();
    }
  });

  it("rejects format=sarif combined with summary", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "query_recipe",
        arguments: {
          recipe: "deprecated-symbols",
          format: "sarif",
          summary: true,
        },
      });
      expect((r as { isError?: boolean }).isError).toBe(true);
      expect(readJson(r)).toMatchObject({
        error: expect.stringContaining("summary"),
      });
    } finally {
      await server.close();
    }
  });
});

describe("MCP server — audit / context / validate tools", () => {
  it("lists audit, context, validate in tools/list", async () => {
    const { client, server } = await makeClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain("audit");
      expect(names).toContain("context");
      expect(names).toContain("validate");
    } finally {
      await server.close();
    }
  });

  it("audit skips its incremental-index prelude when watcher is active (Tracer 4)", async () => {
    // Driver: set the watcher-active flag manually so handleAudit treats
    // the index as fresh. With prelude skipped, audit must NOT throw the
    // 'no last_indexed_commit' error a prelude would have surfaced on a
    // freshly-created DB without git history. Confirms the skip.
    const { _markWatchActiveForTests, _resetWatchStateForTests } =
      await import("./watcher");
    let server: Awaited<ReturnType<typeof makeClient>>["server"] | undefined;
    try {
      // Mark + makeClient + everything else INSIDE the guard so a
      // throw doesn't leak the singleton flag into sibling tests
      // (caught by CodeRabbit on PR #47).
      _markWatchActiveForTests();
      const made = await makeClient();
      server = made.server;
      // Seed a baseline so audit has something to diff against.
      const db = openDb();
      try {
        upsertQueryBaseline(db, {
          name: "watch-skip-files",
          recipe_id: null,
          sql: "SELECT path FROM files",
          rows_json: "[]",
          row_count: 0,
          git_ref: null,
          created_at: 0,
        });
      } finally {
        closeDb(db);
      }
      const r = await made.client.callTool({
        name: "audit",
        arguments: { baseline_prefix: "watch-skip" },
      });
      // No isError — prelude was skipped, audit ran against the live DB.
      expect((r as { isError?: boolean }).isError).toBeUndefined();
      const json = readJson(r);
      expect(json.deltas).toBeDefined();
    } finally {
      if (server !== undefined) await server.close();
      _resetWatchStateForTests();
    }
  });

  it("audit returns isError when no baseline slot resolves", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "audit",
        arguments: { baseline_prefix: "nonexistent", no_index: true },
      });
      expect((r as { isError?: boolean }).isError).toBe(true);
      expect(readJson(r)).toMatchObject({
        error: expect.stringContaining("baseline"),
      });
    } finally {
      await server.close();
    }
  });

  it("audit returns {head, deltas} envelope for a real baseline (no_index)", async () => {
    const db = openDb();
    try {
      upsertQueryBaseline(db, {
        name: "snap-files",
        recipe_id: null,
        sql: "SELECT path FROM files ORDER BY path",
        rows_json: JSON.stringify([
          { path: "docs/c.md" },
          { path: "src/a.ts" },
          { path: "src/b.ts" },
        ]),
        row_count: 3,
        git_ref: null,
        created_at: 1,
      });
    } finally {
      closeDb(db);
    }

    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "audit",
        arguments: { baseline_prefix: "snap", no_index: true },
      });
      const json = readJson(r) as {
        head: unknown;
        deltas: Record<string, { added: unknown[]; removed: unknown[] }>;
      };
      // No source change → no drift on files delta.
      const filesDelta = json.deltas.files;
      expect(filesDelta).toBeDefined();
      expect(filesDelta.added).toEqual([]);
      expect(filesDelta.removed).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("context returns the envelope shape (file count etc.)", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "context",
        arguments: {},
      });
      const json = readJson(r);
      // The context envelope's exact shape lives in cmd-context.ts; smoke-check
      // a couple of fields that should always be present.
      expect(json).toMatchObject({
        codemap: { schema_version: expect.any(Number) },
        project: { root: expect.any(String), file_count: expect.any(Number) },
      });
    } finally {
      await server.close();
    }
  });

  it("validate runs without error on the seeded files", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "validate",
        arguments: { paths: [] },
      });
      const json = readJson(r);
      expect(Array.isArray(json)).toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe("MCP server — baseline tools", () => {
  it("lists save_baseline / list_baselines / drop_baseline in tools/list", async () => {
    const { client, server } = await makeClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain("save_baseline");
      expect(names).toContain("list_baselines");
      expect(names).toContain("drop_baseline");
    } finally {
      await server.close();
    }
  });

  it("save_baseline rejects passing both sql and recipe", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "save_baseline",
        arguments: { name: "x", sql: "SELECT 1", recipe: "fan-out" },
      });
      expect((r as { isError?: boolean }).isError).toBe(true);
      expect(readJson(r)).toMatchObject({
        error: expect.stringContaining("exactly one"),
      });
    } finally {
      await server.close();
    }
  });

  it("save_baseline rejects passing neither sql nor recipe", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "save_baseline",
        arguments: { name: "x" },
      });
      expect((r as { isError?: boolean }).isError).toBe(true);
      expect(readJson(r)).toMatchObject({
        error: expect.stringContaining("exactly one"),
      });
    } finally {
      await server.close();
    }
  });

  it("save_baseline saves SQL rows then list_baselines surfaces it", async () => {
    const { client, server } = await makeClient();
    try {
      const saved = await client.callTool({
        name: "save_baseline",
        arguments: {
          name: "snap-files",
          sql: "SELECT path FROM files ORDER BY path",
        },
      });
      expect(readJson(saved)).toMatchObject({
        saved: "snap-files",
        recipe_id: null,
        row_count: 3,
      });

      const listed = await client.callTool({
        name: "list_baselines",
        arguments: {},
      });
      const json = readJson(listed) as Array<{ name: string }>;
      expect(json.some((b) => b.name === "snap-files")).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("save_baseline saves a recipe (recipe_id surfaces in payload)", async () => {
    const { client, server } = await makeClient();
    try {
      const saved = await client.callTool({
        name: "save_baseline",
        arguments: { name: "snap-deprecated", recipe: "deprecated-symbols" },
      });
      expect(readJson(saved)).toMatchObject({
        saved: "snap-deprecated",
        recipe_id: "deprecated-symbols",
      });
    } finally {
      await server.close();
    }
  });

  it("save_baseline returns isError for unknown recipe id", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "save_baseline",
        arguments: { name: "x", recipe: "nope" },
      });
      expect((r as { isError?: boolean }).isError).toBe(true);
      expect(readJson(r)).toMatchObject({
        error: expect.stringContaining("nope"),
      });
    } finally {
      await server.close();
    }
  });

  it("drop_baseline removes the saved baseline; second drop returns isError", async () => {
    const { client, server } = await makeClient();
    try {
      await client.callTool({
        name: "save_baseline",
        arguments: { name: "to-drop", sql: "SELECT 1" },
      });

      const first = await client.callTool({
        name: "drop_baseline",
        arguments: { name: "to-drop" },
      });
      expect(readJson(first)).toEqual({ dropped: "to-drop" });

      const second = await client.callTool({
        name: "drop_baseline",
        arguments: { name: "to-drop" },
      });
      expect((second as { isError?: boolean }).isError).toBe(true);
      expect(readJson(second)).toMatchObject({
        error: expect.stringContaining("to-drop"),
      });
    } finally {
      await server.close();
    }
  });
});

function readResourceText(r: { contents: unknown[] }): string {
  const first = r.contents[0] as { text?: string };
  if (typeof first.text !== "string") {
    throw new Error("expected text resource content");
  }
  return first.text;
}

describe("MCP server — resources", () => {
  it("lists all four resources via resources/list (one as template)", async () => {
    const { client, server } = await makeClient();
    try {
      const list = await client.listResources();
      const uris = list.resources.map((r) => r.uri);
      // Static resources surface in resources/list directly.
      expect(uris).toContain("codemap://recipes");
      expect(uris).toContain("codemap://schema");
      expect(uris).toContain("codemap://skill");
      // The recipe-by-id resource is a template — surfaced via list-template
      // callback as one entry per recipe id.
      const recipeUris = uris.filter((u) => u.startsWith("codemap://recipes/"));
      expect(recipeUris.length).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it("codemap://recipes returns the catalog as JSON", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.readResource({ uri: "codemap://recipes" });
      expect(r.contents).toHaveLength(1);
      const first = r.contents[0] as { mimeType?: string };
      expect(first.mimeType).toBe("application/json");
      const parsed = JSON.parse(readResourceText(r));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed[0]).toMatchObject({
        id: expect.any(String),
        description: expect.any(String),
        sql: expect.any(String),
      });
    } finally {
      await server.close();
    }
  });

  it("codemap://recipes/{id} resolves a single recipe", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.readResource({
        uri: "codemap://recipes/deprecated-symbols",
      });
      const parsed = JSON.parse(readResourceText(r));
      expect(parsed).toMatchObject({
        id: "deprecated-symbols",
        description: expect.any(String),
        sql: expect.stringContaining("@deprecated"),
        actions: expect.any(Array),
      });
    } finally {
      await server.close();
    }
  });

  it("codemap://schema returns DDL for live tables", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.readResource({ uri: "codemap://schema" });
      const parsed = JSON.parse(readResourceText(r));
      expect(Array.isArray(parsed)).toBe(true);
      const filesEntry = parsed.find(
        (t: { name: string }) => t.name === "files",
      );
      expect(filesEntry).toBeDefined();
      expect(filesEntry.ddl).toContain("content_hash");
    } finally {
      await server.close();
    }
  });

  it("codemap://skill returns the bundled SKILL.md text", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.readResource({ uri: "codemap://skill" });
      const first = r.contents[0] as { mimeType?: string };
      expect(first.mimeType).toBe("text/markdown");
      const text = readResourceText(r);
      // SKILL.md begins with the YAML frontmatter convention.
      expect(text.startsWith("---")).toBe(true);
    } finally {
      await server.close();
    }
  });
});

describe("MCP server — show + snippet tools", () => {
  function seedSymbol(opts: {
    file: string;
    name: string;
    kind?: string;
    lineStart?: number;
    lineEnd?: number;
  }) {
    const db = openDb();
    try {
      db.run(
        `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export)
         VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
        [
          opts.file,
          opts.name,
          opts.kind ?? "function",
          opts.lineStart ?? 1,
          opts.lineEnd ?? 1,
          `${opts.kind ?? "function"} ${opts.name}(): void`,
        ],
      );
    } finally {
      closeDb(db);
    }
  }

  it("lists show + snippet in tools/list", async () => {
    const { client, server } = await makeClient();
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((t) => t.name);
      expect(names).toContain("show");
      expect(names).toContain("snippet");
    } finally {
      await server.close();
    }
  });

  it("show returns {matches} envelope for single match", async () => {
    seedSymbol({ file: "src/a.ts", name: "myFn", lineStart: 5, lineEnd: 10 });
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "show",
        arguments: { name: "myFn" },
      });
      const json = readJson(r);
      expect(json.matches).toHaveLength(1);
      expect(json.matches[0]).toMatchObject({
        name: "myFn",
        file_path: "src/a.ts",
        line_start: 5,
        line_end: 10,
      });
      expect(json.disambiguation).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("show adds disambiguation block for multi-match", async () => {
    seedSymbol({ file: "src/a.ts", name: "shared", kind: "function" });
    seedSymbol({ file: "src/b.ts", name: "shared", kind: "const" });
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "show",
        arguments: { name: "shared" },
      });
      const json = readJson(r);
      expect(json.matches).toHaveLength(2);
      expect(json.disambiguation).toMatchObject({
        n: 2,
        by_kind: { function: 1, const: 1 },
        files: ["src/a.ts", "src/b.ts"],
      });
    } finally {
      await server.close();
    }
  });

  it("show with `in` filter narrows to one file", async () => {
    seedSymbol({ file: "src/a.ts", name: "shared" });
    seedSymbol({ file: "src/b.ts", name: "shared" });
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "show",
        arguments: { name: "shared", in: "src/a.ts" },
      });
      const json = readJson(r);
      expect(json.matches).toHaveLength(1);
      expect(json.matches[0].file_path).toBe("src/a.ts");
    } finally {
      await server.close();
    }
  });

  it("show returns empty matches when name unknown", async () => {
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "show",
        arguments: { name: "definitely-not-a-real-symbol-xyz" },
      });
      const json = readJson(r);
      expect(json.matches).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("snippet returns source text from disk + stale: false on fresh file", async () => {
    // Write a real file matching the seeded `files` row in the bench setup
    // (src/a.ts already exists with hash 'h1' but content "export const A = 1;\n").
    // Seed a symbol pointing at line 1.
    seedSymbol({
      file: "src/a.ts",
      name: "A",
      kind: "const",
      lineStart: 1,
      lineEnd: 1,
    });
    // The bench uses content_hash = 'h1' which DOES NOT match hashContent("export const A = 1;\n"),
    // so the engine will report stale: true. To test stale: false we'd need to update the row's hash.
    const db = openDb();
    try {
      const realHash = (
        require("../hash") as typeof import("../hash")
      ).hashContent("export const A = 1;\n");
      db.run("UPDATE files SET content_hash = ? WHERE path = ?", [
        realHash,
        "src/a.ts",
      ]);
    } finally {
      closeDb(db);
    }
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "snippet",
        arguments: { name: "A" },
      });
      const json = readJson(r);
      expect(json.matches).toHaveLength(1);
      expect(json.matches[0].source).toBe("export const A = 1;");
      expect(json.matches[0].stale).toBe(false);
      expect(json.matches[0].missing).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("snippet flags stale: true when on-disk content drifts from indexed hash", async () => {
    // Bench file content is "export const A = 1;\n" but indexed hash is 'h1' (mismatch).
    seedSymbol({ file: "src/a.ts", name: "A", lineStart: 1, lineEnd: 1 });
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "snippet",
        arguments: { name: "A" },
      });
      const json = readJson(r);
      expect(json.matches[0].stale).toBe(true);
      // Source is still returned per Q-6 settled.
      expect(json.matches[0].source).toBe("export const A = 1;");
    } finally {
      await server.close();
    }
  });

  it("snippet flags missing: true when file is gone on disk", async () => {
    seedSymbol({ file: "src/b.ts", name: "B", lineStart: 1, lineEnd: 1 });
    // src/b.ts is in the indexed `files` but no actual file on disk in bench setup.
    const { client, server } = await makeClient();
    try {
      const r = await client.callTool({
        name: "snippet",
        arguments: { name: "B" },
      });
      const json = readJson(r);
      expect(json.matches[0].missing).toBe(true);
      expect(json.matches[0].source).toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
