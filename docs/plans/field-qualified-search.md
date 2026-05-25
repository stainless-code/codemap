# Field-qualified search — plan

> **Status:** open (in review) · **PR:** [#138](https://github.com/stainless-code/codemap/pull/138) · **Priority:** P1 · **Effort:** M (~1 week)
>
> **Motivator:** Agents often search with partial constraints (`kind:function`, `path:src/api`, `name:Auth`). Today they must write SQL or use exact `show` — higher friction for discovery queries.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p1)

---

## Pre-locked decisions

| #   | Decision                                                                                                                          | Source                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| L.1 | **Moat-A clean** — parser translates to SQL WHERE clauses; always log/return equivalent SQL in `--print-sql` mode.                | [Moat A](../roadmap.md#moats-load-bearing) |
| L.2 | Fields v1: `kind:`, `name:`, `path:`, `in:` (file glob). Optional FTS join when `--with-fts`.                                     | Minimal surface                            |
| L.3 | Surface on **`show` convenience** and MCP **`show`** / **`snippet`** — not a separate verdict engine or standalone `search` tool. | Thin layer                                 |
| L.4 | Document SQL equivalents in bundled skill.                                                                                        | Transparency                               |

---

## Syntax (v1)

```
kind:function name:Auth path:src/
name:"useQuery" kind:hook   # hook → kind filter via components.hooks_used optional v2
```

Free text without `field:` prefix → `name LIKE` or FTS if enabled.

---

## Implementation steps

1. **`src/application/search-query-parser.ts`** — tokenize `field:value` pairs (reuse recipe-params escaping patterns)
2. **`src/application/search-engine.ts`** — build parameterized SQL against `symbols` (+ optional `source_fts`)
3. **CLI** — `codemap show --query 'kind:function name:foo'` or extend `show` flags
4. **MCP** — extend `show` input schema with `query` string
5. **Tests** — parser unit tests + golden SQL snapshots
6. **Skill update** — "field search ≡ this SQL"

---

## Acceptance

- [x] `kind:function name:auth` returns same rows as documented SQL
- [x] `--print-sql` shows generated statement
- [x] Invalid field names → clear error

---

## Dependencies

Optional synergy with [fts-default-on-evaluation](./fts-default-on-evaluation.md) for body-aware search.
