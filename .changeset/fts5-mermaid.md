---
"@stainless-code/codemap": patch
---

feat(fts5+mermaid): opt-in FTS5 virtual table + Mermaid output formatter

Implements the FTS5+Mermaid plan ([`docs/plans/fts5-mermaid.md`](https://github.com/stainless-code/codemap/blob/main/docs/plans/fts5-mermaid.md)) — two non-goal flips in one PR.

**FTS5 (opt-in, default OFF):**

- New `source_fts` virtual table — `(file_path UNINDEXED, content)` columns, `tokenize='porter unicode61'`. Always created; populated only when toggle is on.
- Toggle via `codemap.config.ts` `fts5: true` OR `--with-fts` CLI flag at index time. CLI overrides config (logs stderr line on override).
- Indexer tees file content into `source_fts` in same transaction as `files` row insert (atomic). Worker → main serialization cost is zero on default-OFF path.
- Toggle-change auto-detect via `meta.fts5_enabled` — flipping `fts5: false → true` auto-upgrades incremental → full rebuild so `source_fts` is consistently populated.
- DB-size telemetry on first FTS5 populate: `[fts5] source_fts populated: <N> files / <X> KB`.
- Bundled demo recipe `text-in-deprecated-functions` — `@deprecated` functions in files containing `TODO`/`FIXME`/`HACK` markers AND coverage `<50%`. Demonstrates FTS5 ⨯ `symbols` ⨯ `coverage` JOIN composability that ripgrep can't match.

**Mermaid output formatter:**

- New `--format mermaid` output mode. Renders `{from, to, label?, kind?}` row-shape as `flowchart LR`.
- **Bounded-input contract** (50-edge ceiling, `MERMAID_MAX_EDGES`): unbounded inputs reject with a scope-suggestion error naming the recipe + count + scoping knobs (`LIMIT` / `--via` / `WHERE`). Auto-truncation deliberately out of scope (would be a verdict masquerading as an output mode).
- Available across CLI, MCP `query` / `query_recipe` tools, HTTP `POST /tool/query` (text/plain content type).

Schema bump: `SCHEMA_VERSION` 6 → 7. First reindex after upgrade triggers a full rebuild via the existing version-mismatch path; existing `.codemap/index.db` is preserved (only schema-managed tables get dropped + recreated).

**Pre-v1 patch** per `.agents/lessons.md` "changesets bump policy" — additive feature, default-OFF for FTS5, behaviour-preserving for existing users (`--with-fts` is opt-in; Mermaid is a new output mode).

Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` mention `--with-fts`, `--format mermaid`, the new bundled recipe, and the bounded-input contract.
