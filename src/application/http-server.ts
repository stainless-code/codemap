import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";
import type { ZodRawShape } from "zod";

import { loadUserConfig, resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import {
  getExcludeDirNames,
  getProjectRoot,
  getTsconfigPath,
  initCodemap,
} from "../runtime";
import { listResources, readResource } from "./resource-handlers";
import {
  auditArgsSchema,
  contextArgsSchema,
  dropBaselineArgsSchema,
  handleAudit,
  handleContext,
  handleDropBaseline,
  handleImpact,
  handleListBaselines,
  handleQuery,
  handleQueryBatch,
  handleQueryRecipe,
  handleSaveBaseline,
  handleShow,
  handleSnippet,
  handleValidate,
  impactArgsSchema,
  listBaselinesArgsSchema,
  queryArgsSchema,
  queryBatchArgsSchema,
  queryRecipeArgsSchema,
  saveBaselineArgsSchema,
  showArgsSchema,
  snippetArgsSchema,
  validateArgsSchema,
} from "./tool-handlers";
import type { ToolResult } from "./tool-handlers";
import {
  createPrimeIndex,
  createReindexOnChange,
  DEFAULT_DEBOUNCE_MS,
  runWatchLoop,
} from "./watcher";

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
  stateDir?: string | undefined;
  host: string;
  port: number;
  /** Bearer token; if undefined the server skips auth. */
  token: string | undefined;
  /**
   * If true, boot a co-process file watcher (chokidar via
   * `runWatchLoop`) so the server's tools always read live data. Drains
   * pending events on shutdown. See [`docs/architecture.md` § Watch wiring](../../docs/architecture.md#cli-usage).
   */
  watch?: boolean;
  /** Coalesce burst events into one reindex after `debounceMs` of quiet. Only meaningful when `watch: true`. */
  debounceMs?: number;
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
  "impact",
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
          (opts.token !== undefined ? " (auth: Bearer)" : "") +
          (opts.watch === true ? " (watch: on)" : ""),
      );
      resolve();
    });
  });

  let stopWatch: (() => Promise<void>) | undefined;
  if (opts.watch === true) {
    try {
      const handle = runWatchLoop({
        root: getProjectRoot(),
        excludeDirNames: getExcludeDirNames(),
        debounceMs: opts.debounceMs ?? DEFAULT_DEBOUNCE_MS,
        onPrime: createPrimeIndex({ quiet: false, label: "codemap serve" }),
        onChange: createReindexOnChange({
          quiet: false,
          label: "codemap serve",
        }),
      });
      stopWatch = handle.stop;
    } catch (err) {
      // Watcher boot threw AFTER `server.listen()` resolved — close
      // the listener so we don't leak an orphaned HTTP socket on a
      // failed boot. Caught by CodeRabbit on PR #47.
      await new Promise<void>((res) => server.close(() => res()));
      throw err;
    }
  }

  await new Promise<void>((resolve) => {
    const shutdown = (signal: string) => {
      // eslint-disable-next-line no-console -- intentional shutdown log on stderr
      console.error(`codemap serve: ${signal} received, shutting down...`);
      const closeServer = (): void => {
        server.close(() => resolve());
      };
      if (stopWatch !== undefined) {
        // .finally(closeServer) so a watcher stop() rejection still
        // closes the HTTP listener — without it, a rejected stop()
        // means closeServer never runs and runHttpServer never resolves
        // on SIGTERM/SIGINT (caught by CodeRabbit on PR #47).
        stopWatch()
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            // eslint-disable-next-line no-console -- intentional shutdown-error log
            console.error(`codemap serve: watcher stop failed — ${msg}`);
          })
          .finally(closeServer);
      } else {
        closeServer();
      }
    };
    process.once("SIGINT", () => shutdown("SIGINT"));
    process.once("SIGTERM", () => shutdown("SIGTERM"));
  });
}

async function bootstrapForServe(opts: HttpServerOpts): Promise<void> {
  const user = await loadUserConfig(opts.root, opts.configFile, {
    stateDir: opts.stateDir,
  });
  initCodemap(
    resolveCodemapConfig(opts.root, user, { stateDir: opts.stateDir }),
  );
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
  // IPv6 literals (`::1`, `::`) must be bracketed in URLs per RFC 3986;
  // `new URL("/", "http://::1:7878")` throws otherwise.
  const baseHost =
    opts.host.includes(":") && !opts.host.startsWith("[")
      ? `[${opts.host}]`
      : opts.host;
  const url = new URL(req.url ?? "/", `http://${baseHost}:${opts.port}`);
  const method = req.method ?? "GET";
  const path = url.pathname;

  // CSRF + DNS-rebinding guard — runs BEFORE every other check (including
  // the auth-exempt /health) so a malicious local webpage can't even probe
  // for liveness. See `csrfCheck` for the threat model.
  // Use the socket's actual local port (not opts.port) — when bound to
  // port 0 the OS picks one, and the configured opts.port stays 0. The
  // request socket always knows the real port it accepted on.
  const actualPort = req.socket.localPort ?? opts.port;
  const csrfReason = csrfCheck(req, opts.host, actualPort);
  if (csrfReason !== undefined) {
    return writeJson(
      res,
      403,
      { error: `codemap serve: ${csrfReason}` },
      opts.version,
    );
  }

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
    return writeJson(
      res,
      result.status ?? 400,
      { error: result.error },
      version,
    );
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

  // Per-tool dispatch. Each branch validates the body against the
  // tool's exported Zod schema (same schema MCP uses via inputSchema)
  // and short-circuits to 400 on validation failure — HTTP boundary
  // matches MCP's contract instead of letting handlers fail deep with
  // generic errors. Schemas are `ZodRawShape` (record of Zod fields),
  // so wrap with `z.object(...)` before `.safeParse(...)`.
  let result: ToolResult;
  switch (name) {
    case "query": {
      const r = validate(queryArgsSchema, args, "query");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleQuery(r.value, opts.root);
      break;
    }
    case "query_recipe": {
      const r = validate(queryRecipeArgsSchema, args, "query_recipe");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleQueryRecipe(r.value, opts.root);
      break;
    }
    case "query_batch": {
      const r = validate(queryBatchArgsSchema, args, "query_batch");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleQueryBatch(r.value, opts.root);
      break;
    }
    case "audit": {
      const r = validate(auditArgsSchema, args, "audit");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = await handleAudit(r.value);
      break;
    }
    case "context": {
      const r = validate(contextArgsSchema, args, "context");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleContext(r.value);
      break;
    }
    case "validate": {
      const r = validate(validateArgsSchema, args, "validate");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleValidate(r.value);
      break;
    }
    case "show": {
      const r = validate(showArgsSchema, args, "show");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleShow(r.value, opts.root);
      break;
    }
    case "snippet": {
      const r = validate(snippetArgsSchema, args, "snippet");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleSnippet(r.value, opts.root);
      break;
    }
    case "impact": {
      const r = validate(impactArgsSchema, args, "impact");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleImpact(r.value);
      break;
    }
    case "save_baseline": {
      const r = validate(saveBaselineArgsSchema, args, "save_baseline");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleSaveBaseline(r.value, opts.root);
      break;
    }
    case "list_baselines": {
      const r = validate(listBaselinesArgsSchema, args, "list_baselines");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleListBaselines();
      break;
    }
    case "drop_baseline": {
      const r = validate(dropBaselineArgsSchema, args, "drop_baseline");
      if (!r.ok) return writeJson(res, 400, { error: r.error }, opts.version);
      result = handleDropBaseline(r.value);
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
 * Wrap a tool's `ZodRawShape` (record of `key: ZodType`) with `z.object`
 * and parse the request body. On failure, format every Zod issue as
 * `<path>: <message>` joined with `; ` for a single-line error suitable
 * for the `{"error": "..."}` HTTP response. Same format `mcp-server.ts`
 * gets for free via the SDK's `inputSchema` validation.
 */
function validate<T extends ZodRawShape>(
  shape: T,
  value: unknown,
  toolName: string,
): { ok: true; value: z.infer<z.ZodObject<T>> } | { ok: false; error: string } {
  const parsed = z.object(shape).safeParse(value);
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    error: `codemap serve: invalid args for tool "${toolName}" — ${issues}`,
  };
}

/**
 * Reject requests likely to be browser-driven CSRF or DNS-rebinding
 * attempts. Defense-in-depth — runs before every route, including the
 * auth-exempt `/health`, so a malicious local webpage can't even probe.
 *
 * **Threat model.** A developer runs `codemap serve` on `127.0.0.1:7878`.
 * While the developer's browser is on `evil.com`, JS on that page can
 * issue `fetch('http://127.0.0.1:7878/tool/save_baseline', {method: 'POST', body: '{...}'})`.
 * The browser sends the request (CORS only blocks the *response* from
 * being read by JS — the request itself reaches us and any side effect
 * executes). For state-changing tools (`save_baseline`, `drop_baseline`)
 * this lets a malicious page mutate the developer's `.codemap.db`.
 *
 * DNS rebinding extends the same attack: `evil.com` resolves to
 * `127.0.0.1` after page load; the browser sends `Host: evil.com:7878`
 * to our loopback listener.
 *
 * **Defenses (in order):**
 *
 * 1. **`Sec-Fetch-Site`** — modern browsers always send this on every
 *    request. Reject `cross-site` / `same-site` (would-be CSRF).
 *    Non-browser clients (curl, fetch from Node, MCP hosts, CI scripts)
 *    don't send it, so they pass.
 * 2. **`Host` header** — when bound to loopback, only accept the literal
 *    loopback names (`127.0.0.1` / `localhost` / `[::1]` + the configured
 *    port). Defends DNS rebinding. Skipped when the user explicitly opted
 *    in to a non-loopback bind via `--host 0.0.0.0` / a real IP — the
 *    Host header could legitimately be any hostname that resolves to
 *    that interface.
 * 3. **`Origin`** — fallback for older browsers that don't send
 *    `Sec-Fetch-Site`. Browsers send `Origin` on every non-GET request
 *    (and most GETs); non-browser clients don't. Reject if present.
 *
 * Returns a reason string (becomes the 403 body) or `undefined` to allow.
 */
function csrfCheck(
  req: IncomingMessage,
  host: string,
  port: number,
): string | undefined {
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite === "cross-site" || fetchSite === "same-site") {
    return `cross-origin request rejected (Sec-Fetch-Site: ${String(fetchSite)}). codemap serve does not accept browser-driven cross-origin requests.`;
  }

  if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
    const hostHeader = req.headers.host;
    if (hostHeader !== undefined) {
      const allowed = new Set([
        `127.0.0.1:${port}`,
        `localhost:${port}`,
        `[::1]:${port}`,
        `${host}:${port}`,
      ]);
      if (!allowed.has(hostHeader)) {
        return `unexpected Host header "${hostHeader}" (possible DNS rebinding) — loopback bind only accepts 127.0.0.1:${port} / localhost:${port} / [::1]:${port}.`;
      }
    }
  }

  const origin = req.headers.origin;
  if (origin !== undefined && origin !== "" && origin !== "null") {
    return `cross-origin request rejected (Origin: ${origin}). codemap serve does not accept browser-driven cross-origin requests.`;
  }

  return undefined;
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
