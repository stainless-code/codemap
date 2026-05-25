# Codemap MCP — tool selection

Operational playbook injected into the MCP initialize handshake. Full schema, recipe catalog, and query patterns live in **`codemap://skill`** and **`codemap://rule`** (same content as `codemap skill` / `codemap rule` on CLI).

## Session start

1. **`context`** — project root, schema version, file/symbol counts, recipe summary (one call replaces 4–5 queries).
2. **`codemap://rule`** — always-on priming: query the index for structure, don't grep.
3. When you need the catalog or DDL: **`codemap://recipes`**, **`codemap://schema`**.

## Common tasks

| Goal                          | MCP tool                                             | Recipe twin (`query_recipe`)                                                   |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| Exact symbol lookup           | **`show`** (`name`, optional `in`)                   | `find-symbol-definitions`                                                      |
| Kind / pattern lookup         | **`query_recipe`**                                   | `find-symbol-by-kind`                                                          |
| Source at symbol              | **`snippet`**                                        | same rows as `show` + disk text                                                |
| Blast radius                  | **`impact`** (`target`, `direction`, `via`, `depth`) | `fan-in` for file hubs; symbol call graph via SQL or `impact`                  |
| CI / SARIF                    | **`query_recipe`** + `format: "sarif"`               | `deprecated-symbols`, `boundary-violations`, …                                 |
| Ad-hoc SQL                    | **`query`**                                          | —                                                                              |
| N statements / one round-trip | **`query_batch`** (MCP-only)                         | N × `query`                                                                    |
| Index freshness               | **`validate`**                                       | —                                                                              |
| Drift vs baseline             | **`audit`**                                          | saved via `save_baseline` + `query_recipe` / `query`                           |
| Apply recipe diff rows        | **`apply`**                                          | recipe must emit `{file_path, line_start, before_pattern, after_pattern}` rows |

## Chains

- Rename: `find-symbol-definitions` → `find-symbol-references` (both via **`query_recipe`**).
- Refactor risk: `fan-in` + `refactor-risk-ranking`.
- Edit path: **`show`** → **`snippet`**; if `stale: true`, line range may have drifted.

## Anti-patterns

- Don't grep for "where is X defined" — **`show`** or **`query_recipe`**.
- Don't hand-roll `WITH RECURSIVE` for impact — **`impact`**.
- Convenience tools are thin composers — fall back to **`query_recipe`** / **`query`** when unsure.
- Don't skip **`context`** at session start.

## Recipe ids cited here

`find-symbol-definitions`, `find-symbol-by-kind`, `find-symbol-references`, `fan-in`, `deprecated-symbols`, `boundary-violations`, `refactor-risk-ranking`. Others: list via **`codemap://recipes`** before **`query_recipe`**.

<!-- codemap-mcp-recipe-refs: find-symbol-definitions, find-symbol-by-kind, find-symbol-references, fan-in, deprecated-symbols, boundary-violations, refactor-risk-ranking -->
