# Tiered lookup fast paths — plan

> **Status:** open · **Priority:** P2 (agent session quality) · **Effort:** S–M (~3–5 days)
>
> **Motivator:** Every agent `show` / `find-symbol-definitions` lookup should hit the **`name = ?`** index path first. Today `findSymbolsByName` already uses equality, but the covering index omits columns the SELECT returns; query-mode `name:Foo` still routes through `name LIKE '%Foo%'`; MCP tool descriptions document no fast-vs-slow tier. Roadmap item is unchecked at [`roadmap.md:80`](../roadmap.md#recipe--audit-enrichment).
>
> **Roadmap:** [§ Recipe & audit enrichment — Tiered lookup fast paths](../roadmap.md#recipe--audit-enrichment)

---

## Agent start here

Read [`show-search-mode.ts`](../../src/application/show-search-mode.ts) routing first, then [`show-engine.ts`](../../src/application/show-engine.ts) and [`db.ts` `createIndexes`](../../src/db.ts). **No new MCP tools** — optimize existing `show` / `snippet` / `query_recipe` paths and document tiers in tool descriptions.

### Current behavior (fact-checked)

| Path                | Entry                           | SQL shape                                                                                                                                 | Index use                                                                 |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Exact**           | CLI/MCP `name` arg (no `query`) | `WHERE name = ?` ([`show-engine.ts:52`](../../src/application/show-engine.ts))                                                            | `idx_symbols_name` leading column `name` ([`db.ts:604`](../../src/db.ts)) |
| **Query `name:`**   | `--query 'name:Foo'`            | `name LIKE '%Foo%' ESCAPE '\'` ([`search-engine.ts:48-50`](../../src/application/search-engine.ts))                                       | Leading `name` index **not** used for substring                           |
| **Query free-text** | `--query 'Auth'`                | FTS `source_fts MATCH` when enabled, else `name LIKE '%Auth%'` ([`search-engine.ts:33-37,53-57`](../../src/application/search-engine.ts)) | Slow tier by design                                                       |
| **Recipe**          | `find-symbol-definitions`       | `WHERE name = ?` ([`templates/recipes/find-symbol-definitions.sql:4`](../../templates/recipes/find-symbol-definitions.sql))               | Same as exact show                                                        |

**Covering-index gap:** `findSymbolsByName` SELECT includes `parent_name`, `visibility` ([`show-engine.ts:75-76`](../../src/application/show-engine.ts)); `idx_symbols_name` stops at `is_exported` ([`db.ts:604`](../../src/db.ts)) — SQLite may still table-lookup for those two columns.

**No tiered routing code exists** in `show-engine.ts`, `search-engine.ts`, or `show-search-mode.ts` (grep: no `fast path` / `tiered`).

### Key touchpoints

| File                                                                                                   | Role                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`src/application/show-engine.ts`](../../src/application/show-engine.ts)                               | `findSymbolsByName`                                                                                                                           |
| [`src/application/search-engine.ts`](../../src/application/search-engine.ts)                           | `buildSymbolSearchSql`, `searchSymbols`                                                                                                       |
| [`src/application/show-search-mode.ts`](../../src/application/show-search-mode.ts)                     | `resolveShowLookupMode`, `executeShowLookup`, `resolveSearchWithFts`                                                                          |
| [`src/application/tool-handlers.ts`](../../src/application/tool-handlers.ts)                           | `handleShow`, `handleSnippet`                                                                                                                 |
| [`src/cli/cmd-show.ts`](../../src/cli/cmd-show.ts)                                                     | CLI twin                                                                                                                                      |
| [`src/application/resource-handlers.ts`](../../src/application/resource-handlers.ts)                   | `codemap://symbols/{name}` uses `findSymbolsByName` directly                                                                                  |
| [`src/db.ts`](../../src/db.ts)                                                                         | `createIndexes` — add/replace covering index                                                                                                  |
| [`src/application/mcp-server.ts`](../../src/application/mcp-server.ts)                                 | `registerShowTool`, `registerQueryRecipeTool` descriptions (no latency text today)                                                            |
| [`templates/recipes/find-symbol-definitions.sql`](../../templates/recipes/find-symbol-definitions.sql) | Exact-name recipe                                                                                                                             |
| **Tests**                                                                                              | `show-engine.test.ts`, `search-engine.test.ts`, `show-search-mode.test.ts`, `cmd-show.test.ts`, `tool-handlers.test.ts`, `mcp-server.test.ts` |

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| L.1 | **Fast tier** = equality on `symbols.name` via `findSymbolsByName` or recipe `name = ?`. **Slow tier** = `name LIKE` substring, FTS, or multi-field query.                                                                                                                                                                                                                                                                                                                                                               | Roadmap wording; existing exact path                                                        |
| L.2 | **Query fast-path:** when `parseSearchQuery` yields exactly one `namePatterns[]` entry, **no** `freeText`, **no** `kind`/`path`/`inGlob`, and the pattern contains **no** unescaped `%` or `_`, route to `findSymbolsByName({ name: pattern })` instead of `searchSymbols`. Case-sensitive — same as exact `show` ([`show-engine.ts:26-27`](../../src/application/show-engine.ts)).                                                                                                                                      | Converts `show --query 'name:Foo'` to index-friendly `=`                                    |
| L.3 | **Covering index fix:** add additive index `idx_symbols_name_covering ON symbols(name, kind, file_path, line_start, line_end, signature, is_exported, parent_name, visibility)` via `CREATE INDEX IF NOT EXISTS`. **Do not bump `SCHEMA_VERSION`** — additive index only ([`architecture.md` § Schema Versioning](../architecture.md#schema-versioning)). Keep existing `idx_symbols_name` (other queries may depend on it) unless EXPLAIN shows redundancy; if dropped, do so in a separate commit with benchmark note. | Close parent_name/visibility gap                                                            |
| L.4 | **MCP/CLI descriptions:** document tiers in prose — “exact `name` or `name:Token` without wildcards uses equality index; substring / FTS / multi-field scans are broader.” **No invented millisecond budgets** unless measured in `docs/benchmark.md` first.                                                                                                                                                                                                                                                             | Roadmap “document latency expectations”                                                     |
| L.5 | **FTS remains explicit slow tier** — never auto-enable for `show` exact path.                                                                                                                                                                                                                                                                                                                                                                                                                                            | [`resolveSearchWithFts`](../../src/application/show-search-mode.ts) unchanged for free-text |
| L.6 | **No change** to `query_recipe` SQL execution engine — only `find-symbol-definitions` docs cross-ref fast tier.                                                                                                                                                                                                                                                                                                                                                                                                          | Moat A — recipes stay SQL                                                                   |

---

## Implementation slices

| Slice | Work                                                                                                                                                                                                                                                  | Ship gate                 |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **1** | `isExactNamePattern(pattern)` helper + fast-path branch in `executeShowLookup` / `buildSymbolSearchSql` caller; tests proving `name:Foo` uses `name = ?` SQL                                                                                          | Tracer bullet             |
| **2** | Add `idx_symbols_name_covering` in `createIndexes`; `db.test.ts` asserts index exists; optional EXPLAIN test in `show-engine.test.ts`                                                                                                                 | After Slice 1             |
| **3** | Update MCP `show`/`snippet` descriptions ([`mcp-server.ts:341+`](../../src/application/mcp-server.ts)), `printShowCmdHelp`, [`architecture.md` § Show wiring](../architecture.md), [`glossary.md` § covering index](../glossary.md) row for new index | Same PR or docs follow-up |

### Tracer bullet (Slice 1)

1. In `show-search-mode.ts`, before `searchSymbols`, detect L.2 shape → call `findSymbolsByName`.
2. Add tests in `show-search-mode.test.ts`: `name:Exact` → same rows as exact `name: Exact`; `name:%foo%` stays LIKE.
3. Run `bun test src/application/show-search-mode.test.ts src/application/show-engine.test.ts`.

### Out of scope

- New covering indexes for FTS / `source_fts` (separate backlog)
- `show` fuzzy / case-insensitive match (would break equality semantics)
- Caching query plans in MCP server process (perf-triangulation deferral **6.1**)
- Changing `find-symbol-by-kind` or other recipes to parametrised fast paths

---

## Acceptance

- [ ] `show --query 'name:MySymbol'` generates SQL with `name = ?`, not `LIKE` (test or `--print-sql`)
- [ ] `show MySymbol` and `show --query 'name:MySymbol'` return identical rows for a fixture symbol
- [ ] `show --query 'name:%Sym%'` still uses `LIKE` (slow tier)
- [ ] `idx_symbols_name_covering` exists after index boot (`db.test.ts`)
- [ ] MCP `show` tool description mentions fast (equality) vs slow (substring/FTS) tiers without numeric latency claims
- [ ] `bun test src/application/show-search-mode.test.ts src/application/show-engine.test.ts src/application/search-engine.test.ts`

---

## Verification

```bash
bun test src/application/show-search-mode.test.ts src/application/show-engine.test.ts src/db.test.ts
bun src/index.ts show --query 'name:<KnownSymbol>' --print-sql   # expect name = ?
bun src/index.ts show <KnownSymbol> --json
bun src/index.ts show --query 'name:<KnownSymbol>' --json         # row parity with above
```

Replace `<KnownSymbol>` with a symbol known to exist in the indexed project (e.g. `hashContent` in this repo).

---

## Dependencies

- Shipped: `idx_symbols_name`, field-qualified `show --query`, optional FTS (`fts5` config)
- Synergy with: [`fts-default-on-evaluation.md`](./fts-default-on-evaluation.md) (FTS stays slow tier even when default-on)
- Independent of: codebase map bootstrap, C.9 entry points
