# Codemap MCP — tool selection

Operational playbook injected into the MCP initialize handshake. Full schema, recipe catalog, and query patterns live in **`codemap://skill`** and **`codemap://rule`** (same content as `codemap skill` / `codemap rule` on CLI).

## Session start

1. **`context`** — project root, schema version, file count, language breakdown, **`start_here`** (index summary + recipe cards + hub leaders), recipe catalog, **`index_freshness`** (one call replaces 4–5 queries). Pass **`include_snippets: true`** for one-line export previews on hub leaders (ignored with **`compact: true`**). Prefer **`start_here.hub_leaders`** over legacy **`hubs`** for signatures.
2. **`codemap://rule`** — always-on priming: query the index for structure, don't grep.
3. When you need the catalog or DDL: **`codemap://recipes`**, **`codemap://schema`**.

## Index freshness

Every successful JSON tool response carries index-level freshness metadata (not a pass/fail verdict):

| Surface                                          | Where to read it                                                                                      |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **`context`**                                    | `index_freshness`; **`start_here`** when not `compact` (optional `include_snippets`)                  |
| **Object payloads** (`show`, `query` summary, …) | `index_freshness` merged inline                                                                       |
| **Array payloads** (`query` rows)                | second `content` block prefixed `@codemap/index_freshness`                                            |
| **HTTP**                                         | `X-Codemap-Pending-Sync`, `X-Codemap-Commit-Drift`, `X-Codemap-Warning` headers (JSON body unchanged) |

Key fields: `pending_sync` (watcher debounce queue or in-flight reindex), `commit_drift` (`HEAD` ≠ `last_indexed_commit`), `warning` (single agent-readable line when anything is off).

**Agent guidance**

- If **`pending_sync: true`** — wait ~250ms (debounce) and retry, or call **`validate`** for per-file drift.
- If **`commit_drift: true`** or **`warning`** is set — run **`codemap`** (or rely on watch prime) before treating structural queries as authoritative.
- Prefer **`context`** at session start for the full disk-drift picture; use **`validate`** / snippet `stale` for individual files.

## Common tasks

| Goal                             | MCP tool                                                                                                                                             | Recipe twin (`query_recipe`)                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact symbol lookup              | **`show`** (`name`, optional `in`)                                                                                                                   | `find-symbol-definitions`                                                                                                                   |
| Field-qualified symbol discovery | **`show`** or **`snippet`** (`query` with `kind:` / `name:` / `path:` / `in:` + free text)                                                           | `find-symbol-by-kind` for kind-heavy patterns; CLI `codemap show --query '…' --print-sql` to inspect generated SQL (no MCP `print_sql` arg) |
| Kind / pattern lookup            | **`query_recipe`**                                                                                                                                   | `find-symbol-by-kind`                                                                                                                       |
| Source at symbol                 | **`snippet`**                                                                                                                                        | same rows as `show` + disk text                                                                                                             |
| Blast radius                     | **`impact`** (`target`, `direction`, `via`, `depth`)                                                                                                 | `fan-in` for file hubs; symbol call graph via SQL or `impact`                                                                               |
| Call path + snippets             | **`trace`** (`from`, `to`, `via?`, `max_depth?`, `budget_chars?`) — adaptive snippet caps 15k/10k/6k when omitted                                    | `call-path`                                                                                                                                 |
| Type extends / implements chain  | **`query_recipe`**                                                                                                                                   | `type-ancestors`, `type-descendants` (`file_path` when homonyms; on `type-descendants` also scopes output to that file)                     |
| Multi-symbol survey              | **`explore`** (`names`, `depth?`, `kind?`, `budget_chars?`) — row cap always adaptive (500/250/125); snippets 15k/10k/6k when `budget_chars` omitted | `symbol-neighborhood` (once per name)                                                                                                       |
| One-hop symbol card              | **`node`** (`name`, `kind?`, `in?`, `include_snippets?`, `budget_chars?`) — adaptive snippet caps when snippets enabled                              | `show` + `symbol-neighborhood` with `depth=1`                                                                                               |
| Affected tests                   | **`affected`** (`paths?`, `changed_since?`, `test_glob?`, `max_depth?`)                                                                              | `affected-tests` (RS-delimit multiple paths in `query_recipe` params)                                                                       |
| CI / SARIF                       | **`query_recipe`** + `format: "sarif"`                                                                                                               | `deprecated-symbols`, `boundary-violations`, …                                                                                              |
| Ad-hoc SQL                       | **`query`**                                                                                                                                          | —                                                                                                                                           |
| N statements / one round-trip    | **`query_batch`**                                                                                                                                    | **`codemap query batch`**                                                                                                                   |
| Index freshness (index-level)    | **`context`** (`index_freshness`) + tool metadata above                                                                                              | —                                                                                                                                           |
| Per-file staleness               | **`validate`**                                                                                                                                       | —                                                                                                                                           |
| Drift vs baseline                | **`audit`** (`baseline_prefix` and/or per-delta `baselines`)                                                                                         | save via **`save_baseline`**; CLI-only diff via `codemap query --baseline`                                                                  |
| Apply recipe diff rows           | **`apply`**                                                                                                                                          | recipe must emit `{file_path, line_start, before_pattern, after_pattern}` rows                                                              |

## Chains

- Rename: `find-symbol-definitions` → `find-symbol-references` (both via **`query_recipe`**).
- Call path: **`trace`** (`from`, `to`) or **`query_recipe`** `call-path`; add snippets via **`trace`** / **`node`** / **`explore`** (adaptive snippet caps 15k/10k/6k; explore row cap 500/250/125 always adaptive) or **`snippet`** per row. Dependency hops may return `snippets_skipped_reason` — fall back to **`query_recipe`** + **`snippet`** per hop.
- Type hierarchy: **`query_recipe`** `type-ancestors` / `type-descendants`; pass `file_path` when symbol names collide across files. On **`type-descendants`**, `file_path` also limits results to descendants defined in that file.
- Refactor risk: `fan-in` + `refactor-risk-ranking`.
- Edit path: **`show`** → **`snippet`**; if `stale: true`, line range may have drifted.

## Anti-patterns

- Don't grep for "where is X defined" — **`show`** (exact `name` or `{query: …}`) or **`query_recipe`**.
- Don't hand-roll `WITH RECURSIVE` for impact — **`impact`**.
- Convenience tools are thin composers — fall back to **`query_recipe`** / **`query`** when unsure.
- Don't skip **`context`** at session start.

## Recipe ids cited here

`find-symbol-definitions`, `find-symbol-by-kind`, `find-symbol-references`, `fan-in`, `call-path`, `symbol-neighborhood`, `type-ancestors`, `type-descendants`, `affected-tests`, `deprecated-symbols`, `boundary-violations`, `refactor-risk-ranking`. Others: list via **`codemap://recipes`** before **`query_recipe`**.

<!-- codemap-mcp-recipe-refs: find-symbol-definitions, find-symbol-by-kind, find-symbol-references, fan-in, call-path, symbol-neighborhood, type-ancestors, type-descendants, affected-tests, deprecated-symbols, boundary-violations, refactor-risk-ranking -->
