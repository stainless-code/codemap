---
"@stainless-code/codemap": minor
---

`codemap serve` — HTTP server exposing the same tool taxonomy as `codemap mcp` over `POST /tool/{name}`. For non-MCP consumers (CI scripts, simple `curl`, IDE plugins that don't speak MCP).

Default bind `127.0.0.1:7878` (loopback only — refuse `0.0.0.0` unless explicitly opted in via `--host 0.0.0.0`). Optional `--token <secret>` requires `Authorization: Bearer <secret>` on every request; `GET /health` is auth-exempt so liveness probes work without leaking the token. Bare `node:http` (no Express / Fastify dep) — runs on Bun + Node.

**Routes:**

- `POST /tool/{name}` — every MCP tool (query, query_recipe, query_batch, audit, context, validate, show, snippet, save_baseline, list_baselines, drop_baseline). Body `{<args>}`; response = same `codemap query --json` envelope (NOT MCP's `{content: [...]}` wrapper). `format: "sarif"` payloads ship as `application/sarif+json`; `format: "annotations"` as `text/plain`.
- `GET /resources/{encoded-uri}` — mirror of MCP resources (`codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://skill`).
- `GET /health` — liveness (auth-exempt); `GET /tools` / `GET /resources` — catalogs.
- Errors: `{"error": "..."}` with HTTP status 400 / 401 / 404 / 500.
- Every response carries `X-Codemap-Version: <semver>` so consumers can pin / detect upgrades.

**Internals:** Tool bodies (`application/tool-handlers.ts`) and resource fetchers (`application/resource-handlers.ts`) are pure transport-agnostic — same handlers `codemap mcp` dispatches. No engine duplication; `mcp-server.ts` and `http-server.ts` both wrap the same `ToolResult` discriminated union.

**Security:** CSRF + DNS-rebinding guard rejects requests with `Sec-Fetch-Site: cross-site` / `same-site` (modern-browser CSRF), any `Origin` header that isn't `null` (older-browser CSRF), and `Host` header mismatch on loopback bind (DNS rebinding) — runs on every request including auth-exempt `/health`. Defends against a malicious local webpage `fetch`-ing the API while the developer is browsing. Non-browser clients (curl, MCP hosts, CI scripts) don't send those headers and pass through. SIGINT / SIGTERM → graceful drain. 1 MiB request-body cap (DoS protection). SQLite reader concurrency handles parallel requests; `PRAGMA query_only = 1` set per connection.
