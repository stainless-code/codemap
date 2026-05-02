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

  it("query_recipe returns 404 for unknown recipe (not 400 — semantics matter)", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query_recipe", {
      recipe: "does-not-exist",
    });
    expect(r.status).toBe(404);
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

  it("drop_baseline returns 404 for unknown name (not 400)", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "drop_baseline", {
      name: "does-not-exist",
    });
    expect(r.status).toBe(404);
    expect(r.json.error).toContain("does-not-exist");
  });

  it("save_baseline returns 404 for unknown recipe", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "save_baseline", {
      name: "x",
      recipe: "does-not-exist",
    });
    expect(r.status).toBe(404);
  });
});

describe("http-server — IPv6 host bracketing", () => {
  // Regression test for CodeRabbit finding: opts.host like '::1' was
  // interpolated raw into `http://${host}:${port}`, throwing in
  // new URL(). The fix wraps IPv6 literals in brackets per RFC 3986.
  it("does not throw for IPv6 host in opts (the URL parse path)", async () => {
    // We don't actually bind to ::1 in test (CI loopback config varies);
    // this just exercises the URL-construction path with an IPv6-looking
    // opts.host value to confirm new URL() doesn't throw.
    // The real bind-and-serve smoke would need a CI matrix with IPv6.
    const { createServer } = await import("node:http");
    const { handleRequest } = await import("./http-server");
    const server = createServer((req, res) => {
      void handleRequest(req, res, {
        version: "0.0.0-test",
        root: benchDir,
        host: "::1", // would have thrown before the fix
        port: 7879,
        token: undefined,
      }).catch((err: unknown) => {
        res.statusCode = 500;
        res.end(String(err));
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (typeof addr !== "object" || addr === null) {
      throw new Error("expected AddressInfo");
    }
    const r = await fetch(`http://127.0.0.1:${addr.port}/health`);
    expect(r.status).toBe(200);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
});

describe("http-server — Zod input validation at HTTP boundary", () => {
  // CodeRabbit caught: HTTP path was casting to `any` and forwarding
  // unvalidated bodies to handlers. These tests lock the per-tool
  // safeParse step that now runs before each dispatch.

  it("query without sql → 400 with structured error", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query", {});
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("sql");
    expect(r.json.error).toContain('"query"');
  });

  it("query with sql=number → 400 with type-mismatch error", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query", { sql: 42 });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("sql");
  });

  it("show with name=number → 400 (not deep handler crash)", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "show", { name: 1 });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("name");
  });

  it("query_recipe without recipe → 400", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query_recipe", {});
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("recipe");
  });

  it("save_baseline without name → 400", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "save_baseline", {
      sql: "SELECT 1",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("name");
  });

  it("query_batch with empty statements → 400 (.min(1) fires)", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "query_batch", {
      statements: [],
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("statements");
  });

  it("validation error message names the offending tool + path", async () => {
    serverHandle = await startServer();
    const r = await postTool(serverHandle.port, "snippet", {});
    expect(r.status).toBe(400);
    expect(r.json.error).toContain('"snippet"');
    expect(r.json.error).toContain("name");
  });
});

describe("http-server — GET /resources", () => {
  it("GET /resources returns the catalog", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/resources`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { resources: { uri: string }[] };
    const uris = body.resources.map((x) => x.uri);
    expect(uris).toContain("codemap://recipes");
    expect(uris).toContain("codemap://schema");
    expect(uris).toContain("codemap://skill");
  });

  it("GET /resources/{encoded uri} returns the recipes catalog", async () => {
    serverHandle = await startServer();
    const r = await fetch(
      `http://127.0.0.1:${serverHandle.port}/resources/${encodeURIComponent("codemap://recipes")}`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("application/json");
    const body = (await r.json()) as { id: string }[];
    expect(Array.isArray(body)).toBe(true);
  });

  it("GET /resources/{encoded uri} returns one recipe by id", async () => {
    serverHandle = await startServer();
    const r = await fetch(
      `http://127.0.0.1:${serverHandle.port}/resources/${encodeURIComponent("codemap://recipes/fan-out")}`,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { id: string };
    expect(body.id).toBe("fan-out");
  });

  it("GET /resources/{encoded uri} returns the schema DDL", async () => {
    serverHandle = await startServer();
    const r = await fetch(
      `http://127.0.0.1:${serverHandle.port}/resources/${encodeURIComponent("codemap://schema")}`,
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { name: string; ddl: string }[];
    expect(body.find((t) => t.name === "files")).toBeDefined();
  });

  it("GET /resources/{encoded uri} 404s on unknown URI", async () => {
    serverHandle = await startServer();
    const r = await fetch(
      `http://127.0.0.1:${serverHandle.port}/resources/${encodeURIComponent("codemap://nope")}`,
    );
    expect(r.status).toBe(404);
  });

  it("GET /resources/{encoded uri} 404s on unknown recipe id", async () => {
    serverHandle = await startServer();
    const r = await fetch(
      `http://127.0.0.1:${serverHandle.port}/resources/${encodeURIComponent("codemap://recipes/does-not-exist")}`,
    );
    expect(r.status).toBe(404);
  });
});

describe("http-server — CSRF + DNS-rebinding guard", () => {
  // Threat model documented on csrfCheck() in http-server.ts. The test
  // matrix covers every headers-set combination a malicious local webpage
  // could produce vs every legitimate non-browser client (curl, fetch
  // from Node, MCP hosts, CI scripts).

  it("rejects POST with Sec-Fetch-Site: cross-site (modern-browser CSRF)", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("Sec-Fetch-Site");
  });

  it("rejects POST with Sec-Fetch-Site: same-site (subdomain CSRF)", async () => {
    serverHandle = await startServer();
    const r = await fetch(
      `http://127.0.0.1:${serverHandle.port}/tool/save_baseline`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-site",
        },
        body: JSON.stringify({ name: "x", sql: "SELECT 1" }),
      },
    );
    expect(r.status).toBe(403);
  });

  it("allows Sec-Fetch-Site: none (direct user navigation)", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/health`, {
      headers: { "Sec-Fetch-Site": "none" },
    });
    expect(r.status).toBe(200);
  });

  it("allows Sec-Fetch-Site: same-origin (self-served page on same port)", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/health`, {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    expect(r.status).toBe(200);
  });

  it("rejects Origin header (browser cross-origin POST)", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://evil.com",
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("Origin");
  });

  it("allows Origin: null (file:// pages, sandboxed iframes — non-attack vector)", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "null" },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(r.status).toBe(200);
  });

  it("rejects POST with mismatched Host header (DNS rebinding)", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "evil.com:9999",
      },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("DNS rebinding");
  });

  it("CSRF guard runs before /health (auth-exempt liveness still gated)", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/health`, {
      headers: { "Sec-Fetch-Site": "cross-site" },
    });
    expect(r.status).toBe(403);
  });

  it("legitimate curl-style POST (no Origin / no Sec-Fetch-Site) passes", async () => {
    serverHandle = await startServer();
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1 AS n" }),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([{ n: 1 }]);
  });

  it("allows localhost Host header on loopback bind", async () => {
    serverHandle = await startServer();
    // Host is set automatically by fetch when targeting 127.0.0.1; this test
    // confirms that 127.0.0.1:<port> in the Host header passes (the default
    // for any client that targets the loopback IP literally).
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tool/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(r.status).toBe(200);
  });
});

describe("http-server — --token auth", () => {
  it("rejects POST without Authorization when token set (401)", async () => {
    serverHandle = await startServer({ token: "secret" });
    const r = await postTool(serverHandle.port, "query", {
      sql: "SELECT 1",
    });
    expect(r.status).toBe(401);
    expect(r.json.error).toContain("Bearer");
  });

  it("rejects POST with wrong Authorization (401)", async () => {
    serverHandle = await startServer({ token: "secret" });
    const r = await postTool(
      serverHandle.port,
      "query",
      { sql: "SELECT 1" },
      { token: "wrong" },
    );
    expect(r.status).toBe(401);
  });

  it("accepts POST with correct Bearer token", async () => {
    serverHandle = await startServer({ token: "secret" });
    const r = await postTool(
      serverHandle.port,
      "query",
      { sql: "SELECT 1 AS n" },
      { token: "secret" },
    );
    expect(r.status).toBe(200);
    expect(r.json).toEqual([{ n: 1 }]);
  });

  it("GET /health is auth-exempt even when token is set", async () => {
    serverHandle = await startServer({ token: "secret" });
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/health`);
    expect(r.status).toBe(200);
  });

  it("GET /tools requires the token (catalog leak protection)", async () => {
    serverHandle = await startServer({ token: "secret" });
    const r = await fetch(`http://127.0.0.1:${serverHandle.port}/tools`);
    expect(r.status).toBe(401);
  });
});
