---
actions:
  - type: prioritise-test-targets
    auto_fixable: false
    description: "Files ranked by ascending statement coverage. Lowest-coverage files first — natural backlog for test-writing effort."
---

Files ranked ascending by statement coverage — the "what should we test next?" list.

Aggregates the symbol-level `coverage` table by `file_path` (no separate `file_coverage` rollup table in v1 per D2 of `docs/plans/coverage-ingestion.md`; the GROUP BY is index-bounded by `idx_coverage_file_name`).

`coverage_pct` is `NULL` when a file has zero testable statements (empty modules, type-only files, interface declarations) — sorted last so they don't drown out actual zero-coverage files.

Empty until you run `codemap ingest-coverage <path>`.
