---
actions:
  - type: review-cleanup-priority
    auto_fixable: false
    description: "@deprecated function in an untidy file (TODO/FIXME/HACK markers) with coverage <50% — high-priority cleanup candidate. Migrate or delete before the markers compound."
---

`@deprecated` functions in files with `TODO` / `FIXME` / `HACK` markers AND measured coverage `< 50%`.

**Demonstrates the FTS5 composability advantage** that ripgrep can't match: full-text content search (`source_fts MATCH 'TODO OR FIXME OR HACK'`) JOINed with structural metadata (`symbols.doc_comment` for `@deprecated`) AND coverage data (`coverage.coverage_pct`) in one SQL statement. ripgrep would produce a list of file paths that the agent would then have to JOIN with `symbols` / `coverage` in JS — the round-trip cost is real.

**Returns empty when FTS5 is disabled** (`source_fts` virtual table is empty). Enable via either of:

- `codemap.config.ts` → `export default defineConfig({ fts5: true })` then run `codemap --full`.
- `codemap --with-fts --full` at the CLI (overrides config; logs a stderr line on override).

The toggle-change auto-detect upgrades incremental → full when flipping `fts5: false → true`, so a fresh `--full` is automatic.

**Tuning axes** for project-local overrides at `<projectRoot>/.codemap/recipes/text-in-deprecated-functions.sql`:

- **Different markers**: replace `'TODO OR FIXME OR HACK'` with any FTS5 query (e.g. `'NOTE OR REVIEW'`).
- **Different coverage threshold**: change `< 50` to project's risk-appetite (e.g. `< 80` for stricter projects).
- **Drop the kind filter**: remove `AND s.kind = 'function'` to also surface deprecated classes / types.
- **Per-symbol granularity**: the recipe currently flags any `@deprecated` symbol in a file containing any TODO/FIXME/HACK anywhere — not necessarily inside the symbol's source range. Tightening to `m.line_number BETWEEN s.line_start AND s.line_end` against the `markers` table would give per-symbol precision (different recipe shape; not bundled because `markers` doesn't catch comments inside `.test.ts` boilerplate the same way FTS5 does).
