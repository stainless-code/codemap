---
actions:
  - type: review-for-deletion
    auto_fixable: false
    description: "Exported function with zero callers and zero (or unmeasured) coverage — check `confidence` before deleting. `high` = ingested 0% coverage; `medium` = static dead only (run `codemap ingest-coverage` to confirm). Verify framework entry points (Next.js page.tsx, Storybook, vite.config.ts) per C.9 caveat."
---

# coverage-confirmed-dead

Cross-product of **static dead** (same core as `untested-and-dead`) and **coverage** semantics with an explicit **`confidence`** column — Moat A predicate, not an engine verdict.

| `confidence` | When                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **`high`**   | No AST callers **and** ingested `coverage` row with `coverage_pct = 0`                                                                    |
| **`medium`** | No AST callers **and** no ingested coverage row for the symbol (`coverage_pct` treated as 0 for filtering, but not measurement-confirmed) |

Rows also include **`reason`** (`no_callers_and_zero_coverage` \| `no_callers_and_coverage_unmeasured`), **`caller_count`** (always 0 for rows that pass the dead predicate), and **`coverage_pct`** (`COALESCE` to 0).

## Prerequisite

Run `codemap ingest-coverage <coverage-final.json|lcov.info>` for **`high`** rows. With an empty `coverage` table, every row is **`medium`** — same static dead set as `untested-and-dead`, but agents can sort by `confidence` after ingest.

## Shared predicate (with `untested-and-dead`)

1. **Structural**: `is_exported = 1`, `kind = 'function'`, no incoming AST `calls` (`callee_name = s.name`).
2. **Coverage filter**: `COALESCE(c.coverage_pct, 0) = 0`.

**Known v1 limitation:** `callee_name = s.name` is name-only — homonyms across files share the "no callers" check. Narrow with `file_path` / `is_default_export` filters in project-local overrides (see `untested-and-dead.md`).

**C.9 caveat:** framework entry-point exports (Next.js `page.tsx`, Storybook stories, `vite.config.ts`) may appear as dead until `files.is_entry` ships — triage before deletion.

## Suppressions

Honors `// codemap-ignore-next-line` / `// codemap-ignore-file` for **`untested-and-dead`** or **`coverage-confirmed-dead`**.

```bash
codemap query --recipe coverage-confirmed-dead --json
codemap ingest-coverage coverage/coverage-final.json
codemap query --recipe coverage-confirmed-dead --json   # high + medium rows
```
