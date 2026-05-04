---
"@stainless-code/codemap": patch
---

feat(mcp): add `codemap://files/{path}` + `codemap://symbols/{name}` resources (research note § 1.8)

Two new MCP / HTTP resources for direct agent reads — saves the recipe-compose round-trip when the agent just wants "everything about this file" or "where is this symbol?".

- **`codemap://files/{path}`** — per-file roll-up. Returns `{path, language, line_count, symbols, imports, exports, coverage}`. `imports.specifiers` parsed inline (callers don't have to JSON.parse). `coverage` is `{measured_symbols, avg_coverage_pct, per_symbol}` when coverage was ingested, else `null`. URI-encode the path.
- **`codemap://symbols/{name}`** — symbol lookup by exact name. Returns `{matches, disambiguation?}` envelope (same shape as the `show` verb per PR #39). Optional `?in=<path-prefix>` query parameter mirrors `show --in <path>` (directory prefix or exact file).

Both reuse existing infrastructure (no schema bump): `codemap://files/` queries the existing tables; `codemap://symbols/` reuses `findSymbolsByName` + `buildShowResult` from `application/show-engine.ts`.

**Caching policy:** catalog-style resources (`recipes`, `schema`, `skill`) lazy-cache as before. Data-shaped resources (`files/`, `symbols/`) read live every call — no caching, since the index can change between requests under `--watch`.

Both available over MCP `read_resource` and HTTP `GET /resources/{encoded-uri}` via the existing dispatcher (no new transport plumbing).

Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` codemap rule + skill mention the new resource templates + caching policy.
