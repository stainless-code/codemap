# @stainless-code/codemap

## 0.4.0

### Minor Changes

- [#28](https://github.com/stainless-code/codemap/pull/28) [`91598bc`](https://github.com/stainless-code/codemap/commit/91598bc90889d092fae04e9b51b637e61f6058e4) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `symbols.visibility` column — JSDoc visibility tag (`@public` / `@private` / `@internal` / `@alpha` / `@beta`) extracted at parse time and stored as a real column. Replaces the `LIKE '%@beta%'` regex in the `visibility-tags` recipe. `SCHEMA_VERSION` bumps from 3 to 4 — `.codemap.db` rebuilds automatically on next index. Helper `extractVisibility(doc)` exported from `parser.ts`. New partial index `idx_symbols_visibility` covers `WHERE visibility IS NOT NULL` queries.

### Patch Changes

- [#29](https://github.com/stainless-code/codemap/pull/29) [`03fbddf`](https://github.com/stainless-code/codemap/commit/03fbddfc06f0eb3d7d390d3288ee290d9c4285be) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Update bundled `templates/agents/` rule and skill to cover the recent CLI surface — `codemap query --summary` / `--changed-since <ref>` / `--group-by owner|directory|package`, per-row recipe `actions`, and the new `symbols.visibility` column. The dev-side `.agents/` mirror is updated in lockstep so this clone stays self-consistent.

- [#26](https://github.com/stainless-code/codemap/pull/26) [`c32f052`](https://github.com/stainless-code/codemap/commit/c32f0522321040358dcd0f2d89946dfbb533b9ca) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - `codemap query` Tier A flags — `--summary`, `--changed-since <ref>`, `--group-by owner|directory|package`, plus per-row `actions` templates on bundled recipes. All output filters; the SQL still executes against the index. Ad-hoc SQL and the `cm.query()` programmatic API stay unchanged.

## 0.3.0

### Minor Changes

- [#23](https://github.com/stainless-code/codemap/pull/23) [`ebd4c34`](https://github.com/stainless-code/codemap/commit/ebd4c34ad7b13c573001aec4b3ada8fc3379d08e) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Agent-friendly CLI surface plus a schema v3 bump that tightens `NOT NULL` invariants. Existing `.codemap.db` files auto-rebuild on first open.
  - **New: `codemap validate [--json] [paths...]`** — diffs the on-disk SHA-256 of indexed files against `files.content_hash` and prints stale / missing / unindexed rows. Lets agents skip re-reads they don't need; exits `1` on any drift (git-status semantics)
  - **New: `codemap context [--compact] [--for "<intent>"]`** — emits a stable JSON envelope (project metadata, top hubs, recent markers, recipe catalog) for any agent or editor that wants the index in one cheap shot. `--for` runs lightweight intent classification (refactor / debug / test / feature / explore / other) and returns matched recipe ids plus a hint
  - **New: `codemap --performance`** flag — prints a per-phase timing breakdown (collect / parse / insert / index_create) and the top-10 slowest files by parse time during full rebuilds, for triaging giant or pathological inputs
  - **New: `-r` short alias for `codemap query --recipe`** + cleaner organized `codemap query --help` (sectioned flags, dynamic recipe-id padding, examples for both forms)
  - **New recipes**: `deprecated-symbols` (`@deprecated` JSDoc tag scan), `visibility-tags` (`@internal` / `@private` / `@alpha` / `@beta`), `files-hashes` (powers `validate`), `barrel-files` (top files by export count)
  - **Friendlier no-`.codemap.db` error**: `no such table: <X>` now rewrites to an actionable hint pointing at `codemap` / `codemap --full`, on both the JSON and human paths
  - **Public type surface**: new `IndexPerformanceReport`; `IndexRunStats.performance?` field; per-field JSDoc coverage on `IndexResult`, `IndexRunStats`, `ResolvedCodemapConfig`, all `db.ts` row interfaces (`FileRow`, `SymbolRow`, `ImportRow`, `ExportRow`, `ComponentRow`, `DependencyRow`, `MarkerRow`, `CssVariableRow`, `CssClassRow`, `CssKeyframeRow`, `CallRow`, `TypeMemberRow`), and `ParsedFile`
  - **Documentation**: README now leads with a "What you get" Grep/Read vs Codemap capability table and a "Daily commands" stripe; `docs/why-codemap.md` adds a "What Codemap is **not**" anti-pitch section and a scenario-keyed token-savings table (single lookup → 50-turn session) replacing the earlier hand-wave
  - **Stricter lint baseline**: enabled `prefer-const`, `consistent-type-specifier-style`, `consistent-type-definitions`, `no-confusing-non-null-assertion`, `no-unnecessary-{boolean-literal-compare,template-expression,type-assertion}`, `prefer-{includes,nullish-coalescing,optional-chain}`, and `unicorn/switch-case-braces`
  - **Schema v3 — tighter `NOT NULL` invariants**: every column whose `Row`-interface type was non-nullable is now `NOT NULL` in the SQLite DDL (`files.size`/`line_count`/`language`/`last_modified`/`indexed_at`, `symbols.line_start`/`line_end`/`signature`/`is_exported`/`is_default_export`, `imports.specifiers`/`is_type_only`/`line_number`, `exports.kind`/`is_default`, `components.hooks_used`/`is_default_export`, `markers.line_number`/`content`, `css_variables.scope`/`line_number`, `css_classes.is_module`/`line_number`, `css_keyframes.line_number`, `type_members.is_optional`/`is_readonly`). Existing v2 databases auto-rebuild via `createSchema()`'s version-mismatch detector — no manual action needed

## 0.2.2

### Patch Changes

- [`5f65c33`](https://github.com/stainless-code/codemap/commit/5f65c330d80bede97f4114820cb931bd5ac97a16) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Use vendor-neutral `.md` extension for agent rules in templates; Cursor integration remaps to `.mdc` at wiring time
  - `codemap agents init` now writes `.md` rule files to `.agents/rules/` (plain Markdown with YAML frontmatter)
  - Cursor target automatically renames rules to `.mdc` (required for frontmatter parsing); all other targets (Windsurf, Continue, Cline, Amazon Q) keep `.md`
  - `SKILL.md` now includes `name` and `description` frontmatter per the Agent Skills spec

## 0.2.1

### Patch Changes

- [`7f663be`](https://github.com/stainless-code/codemap/commit/7f663befa4ff45aafe9fd053c68fb929f49bf2eb) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Sync bundled agent rule template with schema v2: add `type_members`, `calls`, and `doc_comment` trigger patterns and query rows. Add golden scenarios and fixture coverage for both new tables.

## 0.2.0

### Minor Changes

- [#19](https://github.com/stainless-code/codemap/pull/19) [`53b2c52`](https://github.com/stainless-code/codemap/commit/53b2c5238fa7c1ccf4ee2081e524da13c5604f52) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Richer symbol metadata: generics, return types, JSDoc, type members, const values, symbol nesting, call graph
  - Signatures now include generic type parameters, return type annotations, and heritage clauses (extends/implements)
  - New `doc_comment` column on symbols extracts leading JSDoc comments
  - New `type_members` table indexes properties and methods of interfaces and object-literal types
  - New `value` column on symbols captures const literal values (strings, numbers, booleans, null)
  - New `parent_name` column on symbols tracks scope nesting; class methods/properties/getters extracted as individual symbols
  - New `calls` table tracks function-scoped call edges with `caller_scope` for qualified disambiguation (deduped per file)
  - Enum members extracted into `members` column as JSON
  - Performance: cached scope strings, hoisted hot-path regex, batch deletes, reduced redundant I/O, BATCH_SIZE 100→500
  - SCHEMA_VERSION bumped to 2

## 0.1.9

### Patch Changes

- [#17](https://github.com/stainless-code/codemap/pull/17) [`e962326`](https://github.com/stainless-code/codemap/commit/e962326991ae4f5a966d0e94cbfb7c3d69341f21) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Fix incremental detection reporting unchanged files as "changed" on every run when the working tree has uncommitted modifications. `getChangedFiles` now compares content hashes against the index before including candidates, so only truly modified files enter the indexing pipeline.

## 0.1.8

### Patch Changes

- [#15](https://github.com/stainless-code/codemap/pull/15) [`f2362f9`](https://github.com/stainless-code/codemap/commit/f2362f9d2b81398a1fa02415fc4a6ed0095d2923) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Fix three HIGH-severity bugs found via cross-audit triangulation, plus performance and docs improvements.

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

## 0.1.7

### Patch Changes

- [#13](https://github.com/stainless-code/codemap/pull/13) [`13a2c14`](https://github.com/stainless-code/codemap/commit/13a2c14daa0dc555fe6dab7d318d2ccd8fdb32de) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Replace `fast-glob` with `tinyglobby` for Node include globs. Smaller dependency footprint; `expandDirectories: false` keeps matching aligned with the previous behavior.

## 0.1.6

### Patch Changes

- [`ca4b47a`](https://github.com/stainless-code/codemap/commit/ca4b47a39a09e3bc6a554258ad7a827157d261c6) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Shipped agent rules and skills now lead with **`codemap query --json`** (optional table output when **`--json`** is omitted). Add **`bun run benchmark:query`** to compare **`console.table`** vs JSON stdout size, plus integration tests for **`--json`** vs default output when **`.codemap.db`** is present. README and **`docs/`** (including **`benchmark.md`** § Query stdout) updated to match.

## 0.1.5

### Patch Changes

- [#10](https://github.com/stainless-code/codemap/pull/10) [`9d37bd5`](https://github.com/stainless-code/codemap/commit/9d37bd508ea39dae33b7ec0d4b8de72e03d2e849) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **Agent templates (`templates/agents/`)**
  - Align **`codemap.mdc`** and **`skills/codemap/SKILL.md`** with the current **`codemap query --json`** contract (bootstrap / DB / SQL failures, **`process.exitCode`**).
  - SKILL: **`QUERY_RECIPES`**-aligned fan-out SQL examples and bundled-recipe determinism note.

## 0.1.4

### Patch Changes

- [#8](https://github.com/stainless-code/codemap/pull/8) [`889ed5b`](https://github.com/stainless-code/codemap/commit/889ed5b695823e9a57f133c9643af9dbb3e89236) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **Query CLI**
  - **`codemap query --json`**: print a JSON array of result rows to stdout (and **`{"error":"…"}`** on SQL errors) for agents and automation. Document that the query subcommand does **not** cap rows — use SQL **`LIMIT`** for bounded results. Update bundled agent rule and skill with **`--json`** preference, verbatim structural answers, and generic SQL recipes (fan-out + sample targets).

  - **`codemap query --recipe <id>`** for bundled read-only SQL so agents can run common structural queries without embedding SQL on the command line. **`--json`** works with recipes the same way as ad-hoc SQL. Bundled ids include dependency **`fan-out`** / **`fan-out-sample`** / **`fan-out-sample-json`** (JSON1 **`json_group_array`**) / **`fan-in`**, index **`index-summary`**, **`files-largest`**, React **`components-by-hooks`** (comma-based hook count, no JSON1), and **`markers-by-kind`**. The benchmark suite uses the **`fan-out`** recipe SQL for an indexed-path scenario; docs clarify that recipes add no extra query cost vs pasting the same SQL.

  - **Recipe discovery (no index / DB):** **`codemap query --recipes-json`** prints all bundled recipes (**`id`**, **`description`**, **`sql`**) as JSON. **`codemap query --print-sql <id>`** prints one recipe’s SQL. **`listQueryRecipeCatalog()`** in **`src/cli/query-recipes.ts`** is the single derived view of **`QUERY_RECIPES`** for the JSON output.

  **Golden tests**
  - **`bun run test:golden`**: index **`fixtures/minimal`**, run scenarios from **`fixtures/golden/scenarios.json`**, and compare query JSON to **`fixtures/golden/minimal/`**. Use **`bun scripts/query-golden.ts --update`** after intentional fixture or schema changes. Documented in **benchmark.md** and **CONTRIBUTING**.

  **Query robustness**
  - With **`--json`**, **`{"error":"…"}`** is printed for invalid SQL, database open failures, and **`codemap query`** bootstrap failures (config / resolver setup), not only bad SQL. The CLI sets **`process.exitCode`** instead of **`process.exit`** so piped stdout is not cut off mid-stream.

  **Benchmark & `CODEMAP_BENCHMARK_CONFIG`**
  - Each **`indexedSql`** in custom scenario JSON is validated as a single read-only **`SELECT`** (or **`WITH` … `SELECT`**) — DDL/DML and **`RETURNING`** are rejected before execution.
  - Config file paths are resolved from **`process.cwd()`** (see **benchmark.md**). **`traditional.regex`** strings are developer-controlled (local JSON); **`files`** mode compiles the regex once per scenario.
  - Overlapping **globs** in the traditional path are **deduplicated** so **Files read** / **Bytes read** count each path once.
  - The default **components in `shop/`** scenario uses a **`LIKE`** filter aligned with the traditional globs under **`components/shop/`** (**\*.tsx** and **\*.jsx**, matching **`components`** rows from the parser) and avoids unrelated paths such as **`workshop`**.

  **Recipes (determinism)**
  - Bundled recipe SQL adds stable secondary **`ORDER BY`** columns (and orders inner **`LIMIT`** samples) so **`--recipe`** / **`--json`** output does not vary on aggregate ties.

  **External QA**
  - **`bun run qa:external`**: **`--max-files`** and **`--max-symbols`** must be positive integers (invalid values throw before indexing).

## 0.1.3

### Patch Changes

- [#6](https://github.com/stainless-code/codemap/pull/6) [`ad29694`](https://github.com/stainless-code/codemap/commit/ad2969481d4bd4e60d4f29818e4f1e64986216f9) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Align shipped agent templates with the published CLI (`codemap`, `npx @stainless-code/codemap`, …). Keep this repository’s `.agents/` rule and skill dev-oriented (`bun src/index.ts`). Remove the redundant `agents-first-convention` template. Document the dev vs `templates/agents/` split in `templates/agents/README.md` and `docs/agents.md`.

## 0.1.2

### Patch Changes

- [#4](https://github.com/stainless-code/codemap/pull/4) [`0a9d829`](https://github.com/stainless-code/codemap/commit/0a9d82935e775edfb942029c03b8a427f18f9e71) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **`codemap agents init`:** For Git repos, ensure **`.codemap.*`** is in **`.gitignore`** (create the file or append the line once). **`--force`** removes only template file paths (same relpaths under **`.agents/rules/`** and **`.agents/skills/`** as **`templates/agents`**) before merging; other files under **`.agents/`**, **`rules/`**, or **`skills/`** are kept. **`--interactive` / `-i`** — pick IDE integrations (Cursor, GitHub Copilot, Windsurf, Continue, Cline, Amazon Q, **`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`**) and symlink vs copy for rule mirrors; requires a TTY. Unknown positional arguments (e.g. `interactive` without `--interactive`) are rejected. Depends on **`@clack/prompts`**.

  **Docs:** **[`docs/agents.md`](https://github.com/stainless-code/codemap/blob/main/docs/agents.md)**; **[`docs/README.md`](https://github.com/stainless-code/codemap/blob/main/docs/README.md)** index updated. Root **[`.gitignore`](https://github.com/stainless-code/codemap/blob/main/.gitignore)** uses a single **`.codemap.*`** line.

## 0.1.1

### Patch Changes

- [#1](https://github.com/stainless-code/codemap/pull/1) [`b366c53`](https://github.com/stainless-code/codemap/commit/b366c532999800a1c0bb6e81aa68e6e8867baf83) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Consolidate docs (index hub, packaging/Releases, benchmark vs external root), point `.changeset/README` at packaging, and add `clean` / `check-updates` npm scripts.

## 0.1.0

### Minor Changes

- Initial release (**0.1.0**): structural SQLite index, CLI (`codemap`, `query`), programmatic API, Zod-validated `codemap.config`, Bun and Node support.
