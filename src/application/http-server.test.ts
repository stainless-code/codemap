import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import { handleRequest } from "./http-server";

let benchDir: string;
let serverHandle: { close: () => Promise<void>; port: number } | undefined;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "http-server-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  writeFileSync(join(benchDir, "src", "a.ts"), "export const A = 1;\n");
  initCodemap(resolveCodemapConfig(benchDir, undefined));
  const db = openDb();
  try {
    createTables(db);
    db.run(
      "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/a.ts', 'h1', 10, 1, 'typescript', 1, 1), ('src/b.ts', 'h2', 10, 1, 'typescript', 1, 1)",
    );
    db.run(
      "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, doc_comment) VALUES ('src/a.ts', 'foo', 'function', 1, 5, 'function foo()', NULL), ('src/a.ts', 'bar', 'const', 7, 7, 'const bar = 1', '/** @deprecated */')",
    );
  } finally {
    closeDb(db);
  }
});

afterEach(async () => {
  if (serverHandle !== undefined) {
    await serverHandle.close();
    serverHandle = undefined;
  }
  rmSync(benchDir, { recursive: true, force: true });
});

/**
 * Boot a test HTTP server. Calls the exported `handleRequest` directly
 * (skipping `runHttpServer`'s SIGINT-awaiting outer loop, which the test
 * runner can't drive). Port 0 → OS picks a free one — avoids collisions
 * across parallel test files.
 */
async function startServer(
  opts: {
    token?: string | undefined;
  } = {},
): Promise<{ port: number; close: () => Promise<void> }> {
  const serverRef: Server = createServer((req, res) => {
    void handleRequest(req, res, {
      version: "0.0.0-test",
      root: benchDir,
      host: "127.0.0.1",
      port: 0,
      token: opts.token,
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: msg }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    serverRef.once("error", reject);
    serverRef.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = serverRef.address();
  if (typeof addr !== "object" || addr === null) {
    throw new Error("expected AddressInfo");
  }
  return {
    port: addr.port,
    close: () =>
      new Promise<void>((resolve) => {
        serverRef.close(() => resolve());
      }),
  };
}

async function postTool(
  port: number,
  name: string,
  body: unknown,
  opts: { token?: string } = {},
): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (opts.token !== undefined)
    headers["Authorization"] = `Bearer ${opts.token}`;
  const r = await fetch(`http://127.0.0.1:${port}/tool/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return {
    status: r.status,
    headers: r.headers,
    json: r.headers.get("content-type")?.includes("json")
      ? await r.json()
      : await r.text(),
  };
}

describe("http-server — health + tools catalog", () => {
  it("GET /health returns ok + version", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/health`);
    expect(r.status).toBe(200);
    expect(r.headers.get("X-Codemap-Version")).toBe("0.0.0-test");
    const body = (await r.json()) as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.0.0-test");
  });

  it("GET /tools returns the catalog", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tools`);
    const body = (await r.json()) as { tools: { name: string }[] };
    expect(body.tools.map((t) => t.name)).toContain("query");
    expect(body.tools.map((t) => t.name)).toContain("audit");
  });

  it("404 for unknown route", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/nope`);
    expect(r.status).toBe(404);
  });
});

describe("http-server — POST /tool/query", () => {
  it("returns row array for ad-hoc SQL", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query", {
      sql: "SELECT name, kind FROM symbols ORDER BY name",
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    expect(r.json).toEqual([
      { name: "bar", kind: "const" },
      { name: "foo", kind: "function" },
    ]);
  });

  it("returns 400 + {error} for bad SQL", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query", {
      sql: "SELECT * FROM nonexistent",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("nonexistent");
  });

  it("returns 400 for invalid JSON body", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not valid json",
    });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("invalid JSON body");
  });

  it("format=sarif returns application/sarif+json", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "SELECT name, file_path, line_start FROM symbols WHERE name = 'bar'",
        format: "sarif",
      }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/sarif+json");
    const doc = (await r.json()) as { version: string };
    expect(doc.version).toBe("2.1.0");
  });

  it("format=annotations returns text/plain", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "SELECT name, file_path, line_start FROM symbols WHERE name = 'bar'",
        format: "annotations",
      }),
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/plain");
    const text = await r.text();
    expect(text).toMatch(/^::notice file=src\/a\.ts,line=7::bar/);
  });
});

describe("http-server — POST /tool/{other tools}", () => {
  it("query_batch returns N envelopes", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query_batch", {
      statements: [{ sql: "SELECT 1 AS n" }, { sql: "SELECT 2 AS n" }],
    });
    expect(r.status).toBe(200);
    expect(r.json).toEqual([[{ n: 1 }], [{ n: 2 }]]);
  });

  it("query_recipe routes to the recipe SQL", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query_recipe", {
      recipe: "deprecated-symbols",
    });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.json[0]).toMatchObject({ name: "bar" });
  });

  it("query_recipe returns 400 for unknown recipe", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query_recipe", {
      recipe: "does-not-exist",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("does-not-exist");
  });

  it("context returns the bootstrap envelope", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "context", { compact: true });
    expect(r.status).toBe(200);
    expect(r.json.codemap.schema_version).toBeGreaterThan(0);
  });

  it("validate returns staleness rows", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "validate", {});
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
  });

  it("show returns matches envelope", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "show", { name: "foo" });
    expect(r.status).toBe(200);
    expect(r.json.matches).toHaveLength(1);
    expect(r.json.matches[0].name).toBe("foo");
  });

  it("snippet returns matches with source/stale/missing fields", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "snippet", { name: "foo" });
    expect(r.status).toBe(200);
    expect(r.json.matches[0]).toHaveProperty("stale");
    expect(r.json.matches[0]).toHaveProperty("missing");
  });

  it("list_baselines returns array (empty when none saved)", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "list_baselines", {});
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
  });

  it("unknown tool returns 404 (not 501)", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "bogus", {});
    expect(r.status).toBe(404);
    expect(r.json.error).toContain("unknown tool");
  });
});
