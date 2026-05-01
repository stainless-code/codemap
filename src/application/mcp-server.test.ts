import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
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
