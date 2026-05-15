---
"@stainless-code/codemap": minor
---

`codemap-richer-index` — substrate extraction across 12 tiers. **Schema bump** (`SCHEMA_VERSION` 10 → 26) — first run after upgrade rebuilds `.codemap/index.db` from source.

**10 new substrate tables**: `import_specifiers`, `scopes`, `references`, `bindings`, `function_params`, `file_metrics`, `re_export_chains`, `module_cycles`, `runtime_markers`, `test_suites`.

**Column additions**: `symbols.{name_column_start, name_column_end, scope_local_id, body_line_count, param_count, nesting_depth}` · `calls.{line_start, column_start, column_end}` · `exports.{is_re_export, line_start, line_end, column_start, column_end}` · `markers.{column_start, column_end}`.

**12 new recipes**: `find-references` · `find-symbol-references` · `find-write-sites` · `find-by-param-type` · `large-functions` · `deeply-nested-functions` · `circular-imports` · `barrel-chains` · `find-leftover-console` · `env-var-audit` · `find-skipped-tests` · `tests-by-file`.

**Architecture**: modular extractor pattern (R.17) splits `parser.ts` into per-tier extractors under `src/extractors/` with a shared `ExtractContext`. Targeted reindex stays sub-100ms; full reindex includes bindings resolution + Tarjan SCC + re-export chain materialisation.

**Reference precision**: `references` table emits every identifier USE with column-precise positions; `kind='member'` rows distinguish non-computed property access from bindings. Native JSX tags + JSXAttribute names + long-hand object-literal keys are suppressed. `TSQualifiedName` (e.g. `React.ReactNode`) splits into namespace head (`kind='type'`) + member tail (`kind='member'`). Bindings resolver (full-rebuild only) walks same-file scope → imports → globals → unresolved with deduped TypeScript / DOM / Node / ES global sets. Re-export chains followed up to 10 hops with cycle detection.

**Dependency bumps**: `oxc-parser` 0.127 → 0.130 · `zod` 4.3 → 4.4 (dedupe override added so the MCP SDK keeps a single `$ZodType` identity) · `tsdown` 0.21 → 0.22 (declared `unrun` as devDep to unblock CI build under Node's tsdown binstub).

**Docs sync**: `docs/architecture.md` § Schema reflects every new table + column; `docs/glossary.md` gains 10 new entries; `docs/golden-queries.md` + `fixtures/golden/` regenerated. Templates (`templates/agents/`) updated with the new schema overview + trigger patterns.
