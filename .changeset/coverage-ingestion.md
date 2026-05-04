---
"@stainless-code/codemap": minor
---

`codemap ingest-coverage <path>` — static coverage ingestion. Reads Istanbul JSON (`coverage-final.json`) or LCOV (`lcov.info`) into a new `coverage` table joinable to `symbols`, so structural queries can compose coverage filters in pure SQL — no runtime tracer, no paid coverage stack.

**Both formats land in v1** (Istanbul + LCOV) so every test runner is a first-class consumer on day one — `vitest --coverage`, `jest --coverage`, `c8`, `nyc` (Istanbul JSON), and `bun test --coverage` (LCOV) all work without waiting on a follow-up release.

**Bundled recipes (auto-discovered, no opt-in needed):**

- `untested-and-dead` — exported functions with no callers AND zero coverage; the killer recipe combining structural and runtime evidence axes.
- `files-by-coverage` — files ranked ascending by statement coverage.
- `worst-covered-exports` — top-20 worst-covered exported functions.

Each recipe ships a frontmatter `actions` block so agents see per-row follow-up hints in `--json` output.

**Schema:**

- New `coverage` table with natural-key PK `(file_path, name, line_start)` — intentionally not a FK to `symbols.id` so coverage rows survive the `symbols` drop-recreate cycle on every `--full` reindex.
- `idx_coverage_file_name` covers the typical join shape and the `GROUP BY file_path` scan used by the `files-by-coverage` recipe.
- Three new `meta` keys (`coverage_last_ingested_at` / `_path` / `_format`) record ingest freshness.
- `SCHEMA_VERSION` 5 → 6 — auto-rebuilds on next `codemap` run; the new table is empty until first `ingest-coverage` invocation. Subsequent bumps preserve coverage data via the `dropAll()` exclusion.

**CLI:**

```bash
codemap ingest-coverage coverage/coverage-final.json   # Istanbul (auto-detected)
codemap ingest-coverage coverage/lcov.info             # LCOV (auto-detected)
codemap ingest-coverage coverage --json                # directory probe (errors if both files present)

codemap query --json --recipe untested-and-dead        # the killer query
```

No `--source` flag — format is auto-detected from extension. No MCP / HTTP transport in v1 — coverage exposes as a SQL column, composable with every existing recipe and ad-hoc query through the existing `query` / `query_recipe` tools (no parallel surface).

Plan: PR #56 (merged). Implementation: this PR.
