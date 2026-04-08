---
"@stainless-code/codemap": patch
---

Fix three HIGH-severity bugs found via cross-audit triangulation, plus performance and docs improvements.

**Bug fixes**

- Add missing `onerror` handler on Bun Worker — prevents silent promise hang when a parse worker crashes
- Require JSX return or hook usage for component detection — eliminates false positives (e.g. `FormatCurrency()` in `.tsx` files no longer indexed as a component)
- Include previously-indexed files in incremental and `--files` modes — custom-extension files indexed during `--full` no longer silently go stale

**Performance**

- Batch CSS imports instead of inserting one-at-a-time (both full-rebuild and incremental paths)
- Add `Map<string, Statement>` cache for `better-sqlite3` `run()`/`query()` — avoids ~2,000+ redundant `prepare()` calls on large projects
- Hoist `inner.query()` in `wrap()` to prepare once per call instead of per `.get()`/`.all()`
- Skip `PRAGMA optimize` on `closeDb` for read-only query paths

**Docs**

- Fix Wyhash → SHA-256 in architecture.md and SKILL.md (3 locations)
- Correct `symbols.kind` values (`variable` → `const`, `type_alias` → `type`) and `exports.kind` values
- Clarify `Database.query()` caching is Bun-only; Node statement cache via wrapper
- Update architecture.md: component heuristic, statement cache, `closeDb` readonly, incremental/`--files` custom extensions
- Update benchmark.md and golden-queries.md for enriched fixture

**Testing**

- Enrich `fixtures/minimal/` to cover all 10 indexed tables (CSS module, `@keyframes`, `@import`, non-component PascalCase export, FIXME marker)
- Add 7 new golden scenarios (exports, css_variables, css_classes, css_keyframes, css_imports, markers-all-kinds, components-no-false-positives)

**Cleanup**

- Remove unused `analyzeDependencies: true` from CSS parser
- Deduplicate `fetchTableStats` (was duplicated across `index-engine.ts` and `run-index.ts`)
- Remove dead `eslint-disable-next-line` directives (oxlint doesn't enforce those rules)
- Fix `SCHEMA_VERSION` comment (said "2", value is `1`)
