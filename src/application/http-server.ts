import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import { getProjectRoot, getTsconfigPath, initCodemap } from "../runtime";
import { listResources, readResource } from "./resource-handlers";
import {
  handleAudit,
  handleContext,
  handleDropBaseline,
  handleListBaselines,
  handleQuery,
  handleQueryBatch,
  handleQueryRecipe,
  handleSaveBaseline,
  handleShow,
  handleSnippet,
  handleValidate,
} from "./tool-handlers";
import type { ToolResult } from "./tool-handlers";

/**
 * HTTP server engine — same tool taxonomy as `application/mcp-server.ts`,
 * exposed over `POST /tool/{name}` for non-MCP consumers (CI scripts, IDE
 * plugins that don't speak MCP). Tool bodies live in `tool-handlers.ts`
 * — both transports dispatch the same pure handlers.
 *
 * Loopback default (`127.0.0.1:7878`). Bare `node:http` (no Express /
 * Fastify) keeps the dep surface minimal and runs on Bun + Node alike.
 *
 * See [`docs/architecture.md` § HTTP wiring](../../docs/architecture.md#cli-usage).
 */

export interface HttpServerOpts {
  version: string;
  root: string;
  configFile?: string | undefined;
  host: string;
  port: number;
  /** Bearer token; if undefined the server skips auth. */
  token: string | undefined;
}

const TOOL_NAMES = [
  "query",
  "query_batch",
  "query_recipe",
  "audit",
  "context",
  "validate",
  "show",
  "snippet",
  "save_baseline",
  "list_baselines",
  "drop_baseline",
] as const;

/**
 * Bootstrap codemap once at server boot, then attach a long-running HTTP
 * listener. Resolves on SIGINT / SIGTERM (drains in-flight + closes
 * listener). Errors thrown during boot propagate; per-request errors map
 * to JSON `{"error": "..."}` with appropriate status codes.
 */
export async function runHttpServer(opts: HttpServerOpts): Promise<void> {
  await bootstrapForServe(opts);

  const server = createServer((req, res) => {
    handleRequest(req, res, opts).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      writeJson(res, 500, { error: msg }, opts.version);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => {
      // eslint-disable-next-line no-console -- intentional bootstrap log on stderr
      console.error(
        `codemap serve: listening on http://${opts.host}:${opts.port}` +
          (opts.token !== undefined ? " (auth: Bearer)" : ""),
      );
      resolve();
    });
  });

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      // eslint-disable-next-line no-console -- intentional shutdown log on stderr
      console.error(`codemap serve: ${signal} received, shutting down...`);
      server.close(() => resolve());
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  });
}

async function bootstrapForServe(opts: HttpServerOpts): Promise<void> {
  const user = await loadUserConfig(opts.root, opts.configFile);
  initCodemap(resolveCodemapConfig(opts.root, user));
  configureResolver(getProjectRoot(), getTsconfigPath());
}

/**
 * Top-level request dispatch. Routes:
 *
 * - `GET  /health`               → 200 `{ok: true, version}` (auth-exempt)
 * - `GET  /tools`                → 200 `{tools: [...]}` (catalog)
 * - `POST /tool/{name}`          → tool handler (Tracer 3+)
 * - `GET  /resources/{uri}`      → MCP resource mirror (Tracer 6)
 * - any other                    → 404 `{error}`
 */
/**
 * Top-level request dispatcher. Exported so tests can attach it to their
 * own `createServer(...)` without going through the SIGINT-awaiting
 * `runHttpServer`. Production code calls `runHttpServer` instead.
 */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: HttpServerOpts,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${opts.host}:${opts.port}`);
  const method = req.method ?? "GET";
  const path = url.pathname;

  // Liveness probe — auth-exempt so monitoring works without the token.
  if (method === "GET" && path === "/health") {
    return writeJson(
      res,
      200,
      { ok: true, version: opts.version },
      opts.version,
    );
  }

  // Auth (Tracer 5 will enforce; here we plumb the check shape).
  if (opts.token !== undefined) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${opts.token}`) {
      return writeJson(
        res,
        401,
        {
          error:
            "codemap serve: missing or invalid Authorization: Bearer <token>.",
        },
        opts.version,
      );
    }
  }

  if (method === "GET" && path === "/tools") {
    return writeJson(
      res,
      200,
      { tools: TOOL_NAMES.map((name) => ({ name })) },
      opts.version,
    );
  }

  if (method === "GET" && path === "/resources") {
    return writeJson(res, 200, { resources: listResources() }, opts.version);
  }

  if (method === "GET" && path.startsWith("/resources/")) {
    // URI is percent-encoded after /resources/ — decode then dispatch.
    // Single decodeURIComponent: tests pass the slash-bearing form
    // (e.g. /resources/codemap%3A%2F%2Frecipes%2Ffan-out → codemap://recipes/fan-out).
    const encoded = path.slice("/resources/".length);
    let uri: string;
    try {
      uri = decodeURIComponent(encoded);
    } catch {
      return writeJson(
        res,
        400,
        { error: `codemap serve: invalid percent-encoding in resource URI.` },
        opts.version,
      );
    }
    const payload = readResource(uri);
    if (payload === undefined) {
      return writeJson(
        res,
        404,
        {
          error: `codemap serve: unknown resource "${uri}". GET /resources for the catalog.`,
        },
        opts.version,
      );
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", payload.mimeType);
    res.setHeader("X-Codemap-Version", opts.version);
    res.end(payload.text);
    return;
  }

  if (method === "POST" && path.startsWith("/tool/")) {
    const name = path.slice("/tool/".length);
    if (!(TOOL_NAMES as readonly string[]).includes(name)) {
      return writeJson(
        res,
        404,
        {
          error: `codemap serve: unknown tool "${name}". GET /tools for the catalog.`,
        },
        opts.version,
      );
    }
    return dispatchTool(req, res, name, opts);
  }

  return writeJson(
    res,
    404,
    { error: `codemap serve: no route for ${method} ${path}.` },
    opts.version,
  );
}

/**
 * Read the full request body (JSON-encoded) and parse it. Returns the
 * parsed object on success, or an error envelope on parse failure /
 * empty body. Caller decides whether empty body is OK (some tools take
 * `{}` legitimately — `list_baselines`).
 */
async function readJsonBody(
  req: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string }> {
  const chunks: Buffer[] = [];
  let total = 0;
  // Cap at 1 MiB to avoid trivial DoS via gigantic POST bodies. Real tool
  // payloads (recipes, baselines) are well under 100 KiB.
  const MAX_BYTES = 1024 * 1024;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > MAX_BYTES) {
      return {
        ok: false,
        error: `codemap serve: request body exceeds ${MAX_BYTES} bytes.`,
      };
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return { ok: true, value: {} };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `codemap serve: invalid JSON body: ${msg}` };
  }
}

/**
 * Translate a tool's {@link ToolResult} into an HTTP response. JSON
 * payloads serialize as `application/json`; sarif payloads use
 * `application/sarif+json`; annotations use `text/plain`. Errors map to
 * 4xx / 5xx with `{"error": "..."}` (same shape `codemap query --json`
 * prints on failure — agents and CLI consumers unwrap identically).
 */
function writeToolResult(
  res: ServerResponse,
  result: ToolResult,
  version: string,
): void {
  if (!result.ok) {
    return writeJson(res, 400, { error: result.error }, version);
  }
  if (result.format === "json") {
    return writeJson(res, 200, result.payload, version);
  }
  res.statusCode = 200;
  res.setHeader(
    "Content-Type",
    result.format === "sarif"
      ? "application/sarif+json"
      : "text/plain; charset=utf-8",
  );
  res.setHeader("X-Codemap-Version", version);
  res.end(result.payload);
}

/**
 * Dispatch a `POST /tool/{name}` request to the matching pure handler.
 * Validates the body is JSON; tool-specific schema validation lives in
 * the handler (mirrors MCP — Zod-validated at the SDK layer there, by
 * the wrapper here).
 */
async function dispatchTool(
  req: IncomingMessage,
  res: ServerResponse,
  name: string,
  opts: HttpServerOpts,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body.ok) return writeJson(res, 400, { error: body.error }, opts.version);
  const args = body.value as Record<string, unknown>;

  // Per-tool dispatch. Each branch casts `args` to the handler's typed
  // shape — the handler's Zod-validated boundary still applies inside
  // tool-handlers.ts; HTTP just forwards the parsed JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime shape validated by zod inside each handler
  const a = args as any;
  let result: ToolResult;
  switch (name) {
    case "query": {
      result = handleQuery(a, opts.root);
      break;
    }
    case "query_recipe": {
      result = handleQueryRecipe(a, opts.root);
      break;
    }
    case "query_batch": {
      result = handleQueryBatch(a, opts.root);
      break;
    }
    case "audit": {
      result = await handleAudit(a);
      break;
    }
    case "context": {
      result = handleContext(a);
      break;
    }
    case "validate": {
      result = handleValidate(a);
      break;
    }
    case "show": {
      result = handleShow(a, opts.root);
      break;
    }
    case "snippet": {
      result = handleSnippet(a, opts.root);
      break;
    }
    case "save_baseline": {
      result = handleSaveBaseline(a, opts.root);
      break;
    }
    case "list_baselines": {
      result = handleListBaselines();
      break;
    }
    case "drop_baseline": {
      result = handleDropBaseline(a);
      break;
    }
    default: {
      // Reachable only if TOOL_NAMES gains an entry without a switch arm —
      // the route guard above catches user-typed unknown names.
      return writeJson(
        res,
        500,
        {
          error: `codemap serve: internal — tool "${name}" not dispatched.`,
        },
        opts.version,
      );
    }
  }
  return writeToolResult(res, result, opts.version);
}

/**
 * Write a JSON response with the standard `Content-Type` + version header.
 * Centralised so every response (success, error, 404, etc.) shapes the
 * same way.
 */
function writeJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  version: string,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Codemap-Version", version);
  res.end(JSON.stringify(body));
}
