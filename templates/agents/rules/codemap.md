---
alwaysApply: true
---

# Codemap (structural codebase index)

> **STOP.** Before you call Grep, Glob, SemanticSearch, or Read to answer a **structural** question about this repository — query the Codemap SQLite index first. This is not optional when the question matches a trigger pattern below.

A local database (default **`.codemap/index.db`**) indexes structure: symbols, imports, exports, components, dependencies, markers, CSS variables, CSS classes, CSS keyframes, and (after `codemap ingest-coverage <path>`) static coverage from Istanbul JSON or LCOV. The `.codemap/` directory holds every codemap-managed file (`index.db` + WAL/SHM, `audit-cache/`, project `recipes/`, `config.{ts,js,json}`, self-managed `.gitignore`); override the dir with `--state-dir <path>` or `CODEMAP_STATE_DIR`. The `.codemap/.gitignore` is **codemap-managed and reconciled on every boot** — codemap version bumps auto-apply on next run, no manual cleanup needed.

**Generic defaults:** This rule is **project-agnostic**. After **`codemap agents init`** (or copying these files into **`.agents/`**), **edit your copy** to add app-specific triggers and SQL — upstream text is only a baseline.

## CLI (npm package **`@stainless-code/codemap`**)

Install **[@stainless-code/codemap](https://www.npmjs.com/package/@stainless-code/codemap)** from npm. The executable name is **`codemap`**.

**Run without a global install:** **`npx @stainless-code/codemap`** (npm), **`pnpm dlx @stainless-code/codemap`** (pnpm), **`yarn dlx @stainless-code/codemap`** (Yarn 2+), or **`bunx @stainless-code/codemap`** (Bun) — same flags everywhere. With a **local** devDependency, **`npx codemap`** / **`pnpm exec codemap`**. With a **global** install, **`codemap`** on your **`PATH`**.

**Examples below use `codemap`** — prefix with **`npx @stainless-code/codemap`** (or **`pnpm dlx`**, **`yarn dlx`**, **`bunx`**) when the CLI is not on your **`PATH`**.

| Action                            | Command                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incremental index                 | `codemap`                                                                                                                                                                                                                                                                                                                                                  |
| Query (JSON — default for agents) | `codemap query --json "<SQL>"`                                                                                                                                                                                                                                                                                                                             |
| Query (ASCII table — optional)    | `codemap query "<SQL>"`                                                                                                                                                                                                                                                                                                                                    |
| Query (recipe)                    | `codemap query --json --recipe fan-out` (see **`codemap query --help`**)                                                                                                                                                                                                                                                                                   |
| Outcome alias                     | `codemap dead-code` · `deprecated` · `boundaries` · `hotspots` · `coverage-gaps` — thin wrappers over `query --recipe <id>`; every `query` flag passes through. See `codemap <alias> --help` for the wrapped recipe id. Capped at 5 to avoid sprawl.                                                                                                       |
| Suppressions (opt-in)             | `// codemap-ignore-next-line <recipe-id>` and `// codemap-ignore-file <recipe-id>` (also `#`, `--`, `<!--`, `/*` leaders) populate `suppressions(file_path, line_number, recipe_id)`. Recipes opt in via `LEFT JOIN`; `untested-and-dead` (line + file) and `unimported-exports` (file only) honor today.                                                  |
| Parametrised recipe               | `codemap query --json --recipe find-symbol-by-kind --params kind=function,name_pattern=%Query%` — params declared in recipe `.md` frontmatter and validated before SQL binding.                                                                                                                                                                            |
| Boundary violations               | `codemap query --json --recipe boundary-violations` — joins `dependencies` × `boundary_rules` (config-driven) via SQLite `GLOB`. `.codemap/config.ts` `boundaries: [{name, from_glob, to_glob, action?}]`; default `action: "deny"`. SARIF / annotations work via the `file_path` alias.                                                                   |
| Rename preview                    | `codemap query --recipe rename-preview --params old=usePermissions,new=useAccess,kind=function --format diff` — read-only unified diff; codemap never writes files.                                                                                                                                                                                        |
| Recipe catalog (JSON)             | `codemap query --recipes-json` — every entry includes `last_run_at: number \| null` + `run_count: number` recency fields (Slice 3 of recipe-recency plan). Rank with `jq 'sort_by(.last_run_at // 0) \| reverse'`. Local-only; opt-out via `.codemap/config` `recipe_recency: false`.                                                                      |
| Print one recipe’s SQL            | `codemap query --print-sql fan-out`                                                                                                                                                                                                                                                                                                                        |
| Counts only                       | `codemap query --json --summary -r deprecated-symbols`                                                                                                                                                                                                                                                                                                     |
| PR-scoped rows                    | `codemap query --json --changed-since origin/main -r fan-out`                                                                                                                                                                                                                                                                                              |
| Bucket by owner / dir / pkg       | `codemap query --json --group-by directory -r fan-in`                                                                                                                                                                                                                                                                                                      |
| Save / diff a baseline            | `codemap query --save-baseline -r visibility-tags` then `… --json --baseline -r visibility-tags`                                                                                                                                                                                                                                                           |
| List / drop baselines             | `codemap query --baselines` · `codemap query --drop-baseline <name>`                                                                                                                                                                                                                                                                                       |
| Per-delta audit                   | `codemap audit --json --baseline base` (auto-resolves `base-files` / `base-dependencies` / `base-deprecated`)                                                                                                                                                                                                                                              |
| Audit vs git ref                  | `codemap audit --base origin/main --json` — worktree+reindex against any committish; sub-100ms second run via sha-keyed cache. Mutually exclusive with `--baseline`; per-delta overrides compose. Add `--format sarif` to emit SARIF 2.1.0 directly (one rule per delta key; severity `warning`).                                                          |
| MCP server (for agent hosts)      | `codemap mcp` — JSON-RPC on stdio; one tool per CLI verb. See **MCP** section below.                                                                                                                                                                                                                                                                       |
| Targeted read (metadata)          | `codemap show <name> [--kind <k>] [--in <path>] [--json]` — file:line + signature                                                                                                                                                                                                                                                                          |
| Targeted read (source text)       | `codemap snippet <name> [--kind <k>] [--in <path>] [--json]` — same lookup + source from disk + stale flag                                                                                                                                                                                                                                                 |
| Impact (blast-radius walker)      | `codemap impact <target> [--direction up\|down\|both] [--depth N] [--via <b>] [--limit N] [--summary] [--json]` — replaces hand-composed `WITH RECURSIVE` queries                                                                                                                                                                                          |
| Coverage ingest                   | `codemap ingest-coverage <path> [--runtime] [--json]` — Istanbul (`coverage-final.json`) and LCOV (`lcov.info`) auto-detect from path; V8 is **opt-in** via `--runtime` (treats `<path>` as a `NODE_V8_COVERAGE=...`-style directory of `coverage-*.json` dumps). Joinable to `symbols` for "untested AND dead" queries. Local-only — no SaaS aggregation. |
| SARIF / GH annotations            | `codemap query --recipe deprecated-symbols --format sarif` · `… --format annotations`                                                                                                                                                                                                                                                                      |
| `--ci` aggregate flag             | `codemap query -r deprecated-symbols --ci` (or `audit --base origin/main --ci`) — aliases `--format sarif` + non-zero exit when findings/additions surfaced + suppresses the no-locatable-rows stderr warning. Mutually exclusive with `--json` / `--format <other>`.                                                                                      |
| PR-comment renderer               | `codemap pr-comment <input.json>` (or `-` for stdin) — renders an audit JSON envelope or SARIF doc as a markdown PR-summary comment. Pipe to `gh pr comment <PR> -F -`. Useful for private repos without GHAS, aggregate audit deltas, or bot-context seeding.                                                                                             |
| Mermaid graph (≤50 edges)         | `codemap query --format mermaid 'SELECT from_path AS "from", to_path AS "to" FROM dependencies LIMIT 50'` — recipes / SQL must alias columns to `{from, to, label?, kind?}`; rejects unbounded inputs.                                                                                                                                                     |
| Diff preview                      | `codemap query --format diff '<SQL returning file_path, line_start, before_pattern, after_pattern>'` — read-only unified diff; `--format diff-json` returns structured hunks for agents.                                                                                                                                                                   |
| FTS5 full-text (opt-in)           | `codemap --with-fts --full` enables `source_fts` virtual table; `query --recipe text-in-deprecated-functions` demos JOINs.                                                                                                                                                                                                                                 |
| HTTP server (for non-MCP)         | `codemap serve [--host 127.0.0.1] [--port 7878] [--token <secret>] [--no-watch] [--debounce <ms>]` — same tool taxonomy over POST /tool/{name}. Watcher default-ON since 2026-05.                                                                                                                                                                          |
| Watch mode (live reindex)         | `codemap watch [--debounce 250] [--quiet]` — standalone long-running process; debounced reindex on file changes. `mcp` / `serve` boot the watcher in-process by default — pass `--no-watch` (or `CODEMAP_WATCH=0`) to opt out.                                                                                                                             |

**Recipe metadata:** with **`--json`**, recipes that define an `actions` template append it to every row (kebab-case verb + description — e.g. `fan-out` → `review-coupling`). Under `--baseline`, actions attach to the **`added`** rows only. Parametrised recipes declare `params` in `.md` frontmatter; pass values with `--params key=value[,key=value]` (repeatable; last value wins). Inspect both via **`--recipes-json`**. Ad-hoc SQL never carries actions or params.

**Project-local recipes:** drop `<id>.sql` (and optional `<id>.md` for description + actions) into **`<projectRoot>/.codemap/recipes/`** — auto-discovered, runs via `codemap query --recipe <id>` like bundled. Project recipes win on id collision; check `codemap query --recipes-json` for **`shadows: true`** entries to know when a project recipe overrides the documented bundled version. `<id>.md` supports YAML frontmatter for the per-row action template — block-list shape only (the loader's hand-rolled parser doesn't accept inline-flow `[{...}]`):

```markdown
---
params:
  - name: kind
    type: string
    required: true
    description: "Symbol kind to match."
actions:
  - type: review-coupling
    auto_fixable: false
    description: "High fan-out usually means orchestrator role."
---

(Markdown body — first non-empty line becomes the catalog description.)
```

Validation: SQL is rejected at load time if it starts with DML/DDL (DELETE/DROP/UPDATE/etc.); the runtime `PRAGMA query_only=1` is the parser-proof backstop.

**Baselines** (`query_baselines` table inside `.codemap/index.db`, no parallel JSON files): `--save-baseline[=<name>]` snapshots a result set; `--baseline[=<name>]` diffs the current result against it (added / removed rows; identity = `JSON.stringify(row)`). Name defaults to the `--recipe` id; ad-hoc SQL needs an explicit `=<name>`. Survives `--full` and SCHEMA bumps.

**Audit (`codemap audit`)**: structural-drift command; emits `{head, deltas: {files, dependencies, deprecated}}` (each delta carries its own `base` metadata). Three mutually-exclusive snapshot sources: `--base <ref>` materialises a git committish via `git worktree add` to a sha-keyed cache under `.codemap/audit-cache/`, reindexes a temp DB, then diffs (sub-100ms second run; requires git; `base.source: "ref"`); `--baseline <prefix>` auto-resolves `<prefix>-files` / `<prefix>-dependencies` / `<prefix>-deprecated` from saved `query_baselines` entries (`base.source: "baseline"`); `--<delta>-baseline <name>` is the explicit per-delta override (composes with both). v1 ships no `verdict` / threshold config — consumers compose `--json` + `jq` for CI exit codes. Auto-runs an incremental index before the diff (use `--no-index` to skip for frozen-DB CI).

**Targeted reads (`show` / `snippet`)**: precise lookup by exact symbol name without composing SQL. `show` returns metadata (`file_path:line_start-line_end` + `signature`); `snippet` returns the source text from disk plus `stale` / `missing` flags. Both share the same flag set (`--kind <k>` to filter by `symbols.kind`, `--in <path>` for file-scope filter — directory prefix or exact file). Output envelope is `{matches, disambiguation?}` — single match → `{matches: [{...}]}`; multi-match adds `disambiguation: {n, by_kind, files, hint}` so agents narrow without re-scanning. Name match is exact / case-sensitive — for fuzzy use `query` with `LIKE '%name%'`. Snippet stale-file behavior: `source` is always returned when the file exists; `stale: true` means the line range may have shifted (re-index with `codemap` or `codemap --files <path>` before acting on the source).

**Impact (`codemap impact <target>`)**: symbol/file blast-radius walker — replaces hand-composed `WITH RECURSIVE` queries that agents struggle to write. Target auto-resolves: contains `/` or matches `files.path` → file target; otherwise symbol (case-sensitive). Walks compatible graphs by target kind: **symbol** → `calls` (callers / callees by name); **file** → `dependencies` + `imports` (`resolved_path` only). `--via <b>` overrides; mismatched explicit choices land in `skipped_backends` (no error). Cycle-detected via `WITH RECURSIVE` path-string + `instr` check; bounded by `--depth N` (default 3, `0` = unbounded but still cycle-detected and limit-capped) and `--limit N` (default 500). Output envelope: `{target, direction, via, depth_limit, matches: [{depth, direction, edge, kind, name?, file_path}], summary: {nodes, max_depth_reached, by_kind, terminated_by: 'depth'|'limit'|'exhausted'}}`. `--summary` trims `matches` for cheap CI-gate consumption (`jq '.summary.nodes'`) but preserves the count. SARIF / annotations not supported (graph traversal, not findings). Pure transport-agnostic — same logic across CLI, MCP, and HTTP.

**MCP server (`codemap mcp`)**: stdio MCP (Model Context Protocol) server — agents call codemap as JSON-RPC tools instead of shelling out to the CLI on every read. v1 ships one tool per CLI verb plus four lazy-cached resources:

- **Tools:** `query` / `query_batch` / `query_recipe` / `audit` / `save_baseline` / `list_baselines` / `drop_baseline` / `context` / `validate` / `show` / `snippet` / `impact`. Snake_case keys (Codemap convention matching MCP spec examples + reference servers — spec is convention-agnostic; CLI stays kebab).
- **`query_batch` (MCP-only):** N statements in one round-trip. Items are `string | {sql, summary?, changed_since?, group_by?}` — string form inherits batch-wide flag defaults, object form overrides on a per-key basis. Per-statement errors are isolated.
- **`save_baseline` (polymorphic):** one tool, `{name, sql? | recipe?}` with runtime exclusivity check (mirrors the CLI's single `--save-baseline=<name>` verb).
- **Resources:** `codemap://recipes` (catalog), `codemap://recipes/{id}` (one recipe), `codemap://schema` (live DDL from `sqlite_schema`), `codemap://skill` (bundled SKILL.md text), `codemap://files/{path}` (per-file roll-up: symbols, imports, exports, coverage), `codemap://symbols/{name}` (symbol lookup with `{matches, disambiguation?}` envelope; `?in=<path-prefix>` filter mirrors `show --in`). Catalog resources lazy-cache on first `read_resource`; `files/` and `symbols/` read live every call (no caching) since the index can change between requests under `--watch`.
- **Output shape uniformity:** every tool returns the JSON envelope its CLI counterpart's `--json` would print — no re-mapping.

To use from your agent host: launch `codemap mcp` as the MCP server command. Most hosts (Claude Code, Cursor, Codex) accept a stdio command + working directory; codemap will index the working directory's project root.

**Bundled rules/skills:** **`codemap agents init`** writes **`.agents/`** from the package (see [docs/agents.md](../../../docs/agents.md)).

Index another project: **`--root /path/to/repo`**, or set **`CODEMAP_ROOT`** or **`CODEMAP_TEST_BENCH`** (e.g. in **`.env`** — see [docs/benchmark.md § Indexing another project](../../../docs/benchmark.md#indexing-another-project)). Full rebuild: **`--full`**. Targeted re-index: **`--files path/to/a.ts path/to/b.tsx`**.

**Developing the Codemap repo itself:** from a clone, **`bun src/index.ts`** matches **`codemap`** (same flags); see the repository README.

## Session start (do this ONCE per conversation)

Run incremental indexing to catch changes made outside this session:

```bash
codemap
```

## Pre-flight check (do this EVERY time before searching)

1. **Does the question match a trigger pattern below?**
2. **If yes → query the index.** Do NOT use Grep/Glob/SemanticSearch/Read.
3. **If the index result is incomplete → THEN fall back** to other tools, but always try the index first.

Violating this order is wrong even if you get the right answer — it wastes time and ignores the tool purpose-built for this.

## Trigger patterns

If the question looks like any of these → use the index:

| Question shape                                                | Table(s)                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------- |
| "What/which files import X?"                                  | `imports` (by `source`) or `dependencies` (by `to_path`)  |
| "Where is X defined?"                                         | `symbols`                                                 |
| "What does file X export?"                                    | `exports`                                                 |
| "What hooks does component X use?" / "List React components"  | `components`                                              |
| "What are the CSS variables/tokens for X?"                    | `css_variables`                                           |
| "Find all TODOs/FIXMEs"                                       | `markers`                                                 |
| "Who depends on file X?" / "What does file X depend on?"      | `dependencies`                                            |
| "How many files/symbols/components are there?"                | any table with `COUNT(*)`                                 |
| "What are the CSS classes in X?"                              | `css_classes`                                             |
| "What keyframe animations exist?"                             | `css_keyframes`                                           |
| "What fields does interface/type X have?"                     | `type_members`                                            |
| "Is symbol X deprecated?" / "What does X do?"                 | `symbols` (`doc_comment`)                                 |
| "What's `@internal` / `@beta` / `@alpha` / `@private`?"       | `symbols.visibility` (parsed JSDoc tag — not regex)       |
| "Who calls X?" / "What does X call?"                          | `calls`                                                   |
| "Is symbol X tested?" / "What's the coverage of file Y?"      | `coverage` (after `ingest-coverage`)                      |
| "What's structurally dead AND untested?"                      | `--recipe untested-and-dead`                              |
| "Rank files by test coverage"                                 | `--recipe files-by-coverage`                              |
| "Worst-covered exported functions"                            | `--recipe worst-covered-exports`                          |
| "Which components touch deprecated APIs?"                     | `--recipe components-touching-deprecated`                 |
| "What's risky to refactor right now?"                         | `--recipe refactor-risk-ranking`                          |
| "Which exports has nobody imported?"                          | `--recipe unimported-exports`                             |
| "Find @deprecated functions with TODO/FIXME and low coverage" | `--recipe text-in-deprecated-functions` (needs FTS5 on)   |
| "What's high-complexity AND undertested?"                     | `--recipe high-complexity-untested`                       |
| "What's the cyclomatic complexity of symbol X?"               | `SELECT name, complexity FROM symbols WHERE name = '...'` |

## When Grep / Read IS appropriate

- Reading implementation details you need to edit
- Reviewing logic, control flow, or business rules
- Searching for patterns the index doesn't capture (string literals, inline logic, etc.)

## How to query

```bash
codemap query --json "<SQL>"
```

**Human-readable:** Omit **`--json`** to print **`console.table`** to the terminal (optional; wide results use more lines and bytes than JSON).

**Row count:** The CLI does **not** impose a maximum number of rows. Add **`LIMIT`** (and **`ORDER BY`**) in SQL when you need a bounded list. With **`--json`**, stdout is a JSON array on success; **on failure**, stdout is **`{"error":"<message>"}`** and the process exits **1** (invalid SQL, database open errors, or **`query` bootstrap** failures such as config/resolver — not only SQL runtime errors). The CLI sets **`process.exitCode`** instead of **`process.exit`** so piped stdout is not truncated.

**Verbatim answers:** When the user asks for lists, counts, or enumerated structural data from the index, **paste or summarize from the query output without inventing rows** — do not substitute a prose “summary” that omits rows the user asked to see. Use **`--json`** so the full result set is unambiguous.

## Quick reference queries

| I need to...                      | Query                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Find a symbol                     | `SELECT name, kind, file_path, line_start, line_end, signature FROM symbols WHERE name = '...'`              |
| Find a symbol (fuzzy)             | `SELECT name, kind, file_path, line_start FROM symbols WHERE name LIKE '%...%'`                              |
| See file exports                  | `SELECT name, kind, is_default FROM exports WHERE file_path LIKE '%...'`                                     |
| See file imports                  | `SELECT source, specifiers, is_type_only FROM imports WHERE file_path LIKE '%...'`                           |
| Who imports this module?          | `SELECT DISTINCT file_path FROM imports WHERE source LIKE '~/some/module%'`                                  |
| Who imports this file?            | `SELECT DISTINCT from_path FROM dependencies WHERE to_path LIKE '%...'`                                      |
| What does this depend on?         | `SELECT DISTINCT to_path FROM dependencies WHERE from_path LIKE '%...'`                                      |
| Component info                    | `SELECT name, props_type, hooks_used FROM components WHERE name = '...'`                                     |
| All components                    | `SELECT name, file_path, props_type, hooks_used FROM components ORDER BY name`                               |
| TODOs in a file                   | `SELECT line_number, content FROM markers WHERE file_path LIKE '%...' AND kind = 'TODO'`                     |
| Most complex files                | `SELECT from_path, COUNT(*) as deps FROM dependencies GROUP BY from_path ORDER BY deps DESC LIMIT 10`        |
| CSS design tokens                 | `SELECT name, value, scope FROM css_variables WHERE name LIKE '--%...'`                                      |
| CSS module classes                | `SELECT name, file_path FROM css_classes WHERE is_module = 1`                                                |
| CSS keyframes                     | `SELECT name, file_path FROM css_keyframes`                                                                  |
| Type/interface shape              | `SELECT name, type, is_optional, is_readonly FROM type_members WHERE symbol_name = '...'`                    |
| Deprecated symbols                | `SELECT name, kind, file_path, doc_comment FROM symbols WHERE doc_comment LIKE '%@deprecated%'`              |
| Visibility-tagged symbols         | `SELECT name, kind, visibility, file_path FROM symbols WHERE visibility IS NOT NULL` (or `= 'beta'`, etc.)   |
| Symbol docs                       | `SELECT name, signature, doc_comment FROM symbols WHERE name = '...' AND doc_comment IS NOT NULL`            |
| Const values                      | `SELECT name, value, file_path FROM symbols WHERE kind = 'const' AND value IS NOT NULL AND name LIKE '%...'` |
| Class members                     | `SELECT name, kind, signature FROM symbols WHERE parent_name = '...'`                                        |
| Top-level only                    | `SELECT name, kind, signature FROM symbols WHERE parent_name IS NULL AND file_path LIKE '%...'`              |
| Who calls X?                      | `SELECT DISTINCT caller_name, file_path FROM calls WHERE callee_name = '...'`                                |
| What does X call?                 | `SELECT DISTINCT callee_name FROM calls WHERE caller_name = '...'`                                           |
| Call hotspots                     | `SELECT callee_name, COUNT(*) as fan_in FROM calls GROUP BY callee_name ORDER BY fan_in DESC LIMIT 10`       |
| Symbol coverage                   | `SELECT name, hit_statements, total_statements, coverage_pct FROM coverage WHERE file_path = '...'`          |
| Untested + dead exports           | `codemap query --json --recipe untested-and-dead`                                                            |
| Components touching `@deprecated` | `codemap query --json --recipe components-touching-deprecated`                                               |
| Refactor-risk-ranked files        | `codemap query --json --recipe refactor-risk-ranking`                                                        |
| Exports nobody imports            | `codemap query --json --recipe unimported-exports`                                                           |

**Use `DISTINCT`** on dependency and import queries — a file importing multiple specifiers from the same module produces duplicate rows.

For the full schema, advanced query patterns, and troubleshooting, read the skill at `.agents/skills/codemap/SKILL.md`.

## Keeping it fresh

**After completing a step that modified source files, re-index before making any further queries.** The index only reflects the state at the time it was last built — edits you just made won't appear until you re-index.

```bash
# Targeted — re-index only the files you just touched
codemap --files path/to/file1.tsx path/to/file2.ts

# Incremental — auto-detects changed files via git
codemap

# Full rebuild — after rebase, branch switch, or stale index
codemap --full
```

### When to re-index

- **After editing files** — use `--files` with the paths you modified (fastest). Deleted files are auto-detected and removed from the index
- **After switching branches or rebasing** — run `--full`
- **When unsure which files changed** — run without flags to auto-detect via git
