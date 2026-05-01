---
alwaysApply: true
---

# Codemap (structural codebase index)

> **STOP.** Before you call Grep, Glob, SemanticSearch, or Read to answer a **structural** question about this repository — query the Codemap SQLite index first. This is not optional when the question matches a trigger pattern below.

A local database (default **`.codemap.db`**) indexes structure: symbols, imports, exports, components, dependencies, markers, CSS variables, CSS classes, CSS keyframes.

**This file** is for **developing Codemap** in this clone. **End users** of the published package get the agent rule from **`templates/agents/`** (via **`codemap agents init`**). **Generic defaults:** SQL and triggers stay project-agnostic — **edit** this rule for repo-specific paths and queries.

## CLI (this repository)

| Context                        | Incremental index  | Query                                                                                                                  |
| ------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| **Default** — from this clone  | `bun src/index.ts` | `bun src/index.ts query --json "<SQL>"`                                                                                |
| Same entry                     | `bun run dev`      | (same as first row)                                                                                                    |
| Query (ASCII table — optional) | —                  | `bun src/index.ts query "<SQL>"`                                                                                       |
| Recipe                         | —                  | `bun src/index.ts query --json --recipe fan-out` (see **`bun src/index.ts query --help`**)                             |
| Recipe catalog / SQL           | —                  | `bun src/index.ts query --recipes-json` · `bun src/index.ts query --print-sql fan-out`                                 |
| Counts only                    | —                  | `bun src/index.ts query --json --summary -r deprecated-symbols`                                                        |
| PR-scoped rows                 | —                  | `bun src/index.ts query --json --changed-since origin/main -r fan-out`                                                 |
| Bucket by owner / dir / pkg    | —                  | `bun src/index.ts query --json --group-by directory -r fan-in`                                                         |
| Save / diff a baseline         | —                  | `bun src/index.ts query --save-baseline -r visibility-tags` then `… --json --baseline -r visibility-tags`              |
| List / drop baselines          | —                  | `bun src/index.ts query --baselines` · `bun src/index.ts query --drop-baseline <name>`                                 |
| Per-delta audit                | —                  | `bun src/index.ts audit --json --baseline base` (auto-resolves `base-files` / `base-dependencies` / `base-deprecated`) |
| MCP server (for agent hosts)   | —                  | `bun src/index.ts mcp` — JSON-RPC on stdio; one tool per CLI verb. See **MCP** section below.                          |

**Recipe `actions`:** with **`--json`**, recipes that define an `actions` template append it to every row (kebab-case verb + description — e.g. `fan-out` → `review-coupling`). Under `--baseline`, actions attach to the **`added`** rows only. Inspect via **`--recipes-json`**. Ad-hoc SQL never carries actions.

**Baselines** (`query_baselines` table inside `.codemap.db`, no parallel JSON files): `--save-baseline[=<name>]` snapshots a result set; `--baseline[=<name>]` diffs the current result against it (added / removed rows; identity = `JSON.stringify(row)`). Name defaults to the `--recipe` id; ad-hoc SQL needs an explicit `=<name>`. Survives `--full` and SCHEMA bumps.

**Audit (`bun src/index.ts audit`)**: structural-drift command; emits `{head, deltas: {files, dependencies, deprecated}}` (each delta carries its own `base` metadata). Reuses B.6 baselines as the snapshot source. Two CLI shapes — `--baseline <prefix>` auto-resolves `<prefix>-files` / `<prefix>-dependencies` / `<prefix>-deprecated`; `--<delta>-baseline <name>` is the explicit per-delta override. v1 ships no `verdict` / threshold config — consumers compose `--json` + `jq` for CI exit codes. Auto-runs an incremental index before the diff (use `--no-index` to skip for frozen-DB CI).

**MCP server (`bun src/index.ts mcp`)**: stdio MCP (Model Context Protocol) server — agents call codemap as JSON-RPC tools instead of shelling out to the CLI on every read. v1 ships one tool per CLI verb plus four lazy-cached resources:

- **Tools:** `query` / `query_batch` / `query_recipe` / `audit` / `save_baseline` / `list_baselines` / `drop_baseline` / `context` / `validate`. Snake_case keys throughout (CLI stays kebab — translation at the MCP-arg layer).
- **`query_batch` (MCP-only):** N statements in one round-trip. Items are `string | {sql, summary?, changed_since?, group_by?}` — string form inherits batch-wide flag defaults, object form overrides on a per-key basis. Per-statement errors are isolated.
- **`save_baseline` (polymorphic):** one tool, `{name, sql? | recipe?}` with runtime exclusivity check (mirrors the CLI's single `--save-baseline=<name>` verb).
- **Resources:** `codemap://recipes` (catalog), `codemap://recipes/{id}` (one recipe), `codemap://schema` (live DDL from `sqlite_schema`), `codemap://skill` (bundled SKILL.md text). Lazy-cached on first `read_resource`.
- **Output shape uniformity:** every tool returns the JSON envelope its CLI counterpart's `--json` would print — no re-mapping. Schema additions to the CLI envelope propagate to MCP automatically.

For developing the MCP server itself: `src/cli/cmd-mcp.ts` (CLI shell) + `src/application/mcp-server.ts` (engine). See [`docs/architecture.md` § MCP wiring](../../docs/architecture.md#cli-usage).

After **`bun run build`**, **`node dist/index.mjs`** matches the published **`codemap`** binary (same flags). **`bun link`** / global **`codemap`** also work when testing the packaged CLI.

Index another project: **`--root /path/to/repo`**, or set **`CODEMAP_ROOT`** or **`CODEMAP_TEST_BENCH`** (e.g. in **`.env`** — see [docs/benchmark.md § Indexing another project](../../docs/benchmark.md#indexing-another-project)). Full rebuild: **`--full`**. Targeted re-index: **`--files path/to/a.ts path/to/b.tsx`**.

## Session start (do this ONCE per conversation)

Run incremental indexing to catch changes made outside this session:

```bash
bun src/index.ts
```

## Pre-flight check (do this EVERY time before searching)

1. **Does the question match a trigger pattern below?**
2. **If yes → query the index.** Do NOT use Grep/Glob/SemanticSearch/Read.
3. **If the index result is incomplete → THEN fall back** to other tools, but always try the index first.

Violating this order is wrong even if you get the right answer — it wastes time and ignores the tool purpose-built for this.

## Trigger patterns

If the question looks like any of these → use the index:

| Question shape                                               | Table(s)                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| "What/which files import X?"                                 | `imports` (by `source`) or `dependencies` (by `to_path`) |
| "Where is X defined?"                                        | `symbols`                                                |
| "What does file X export?"                                   | `exports`                                                |
| "What hooks does component X use?" / "List React components" | `components`                                             |
| "What are the CSS variables/tokens for X?"                   | `css_variables`                                          |
| "Find all TODOs/FIXMEs"                                      | `markers`                                                |
| "Who depends on file X?" / "What does file X depend on?"     | `dependencies`                                           |
| "How many files/symbols/components are there?"               | any table with `COUNT(*)`                                |
| "What are the CSS classes in X?"                             | `css_classes`                                            |
| "What keyframe animations exist?"                            | `css_keyframes`                                          |
| "What fields does interface/type X have?"                    | `type_members`                                           |
| "Is symbol X deprecated?" / "What does X do?"                | `symbols` (`doc_comment`)                                |
| "What's `@internal` / `@beta` / `@alpha` / `@private`?"      | `symbols.visibility` (parsed JSDoc tag — not regex)      |
| "Who calls X?" / "What does X call?"                         | `calls`                                                  |

## When Grep / Read IS appropriate

- Reading implementation details you need to edit
- Reviewing logic, control flow, or business rules
- Searching for patterns the index doesn't capture (string literals, inline logic, etc.)

## How to query

```bash
bun src/index.ts query --json "<SQL>"
```

**Human-readable:** Omit **`--json`** to print **`console.table`** to the terminal (optional; wide results use more lines and bytes than JSON).

**Row count:** The CLI does **not** impose a maximum number of rows. Add **`LIMIT`** (and **`ORDER BY`**) in SQL when you need a bounded list. With **`--json`**, stdout is a JSON array on success; **on failure**, stdout is **`{"error":"<message>"}`** and the process exits **1** (invalid SQL, database open errors, or **`query` bootstrap** failures such as config/resolver — not only SQL runtime errors). The CLI sets **`process.exitCode`** instead of **`process.exit`** so piped stdout is not truncated.

**Verbatim answers:** When the user asks for lists, counts, or enumerated structural data from the index, **paste or summarize from the query output without inventing rows** — do not substitute a prose “summary” that omits rows the user asked to see. Use **`--json`** so the full result set is unambiguous.

## Quick reference queries

| I need to...              | Query                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Find a symbol             | `SELECT name, kind, file_path, line_start, line_end, signature FROM symbols WHERE name = '...'`              |
| Find a symbol (fuzzy)     | `SELECT name, kind, file_path, line_start FROM symbols WHERE name LIKE '%...%'`                              |
| See file exports          | `SELECT name, kind, is_default FROM exports WHERE file_path LIKE '%...'`                                     |
| See file imports          | `SELECT source, specifiers, is_type_only FROM imports WHERE file_path LIKE '%...'`                           |
| Who imports this module?  | `SELECT DISTINCT file_path FROM imports WHERE source LIKE '~/some/module%'`                                  |
| Who imports this file?    | `SELECT DISTINCT from_path FROM dependencies WHERE to_path LIKE '%...'`                                      |
| What does this depend on? | `SELECT DISTINCT to_path FROM dependencies WHERE from_path LIKE '%...'`                                      |
| Component info            | `SELECT name, props_type, hooks_used FROM components WHERE name = '...'`                                     |
| All components            | `SELECT name, file_path, props_type, hooks_used FROM components ORDER BY name`                               |
| TODOs in a file           | `SELECT line_number, content FROM markers WHERE file_path LIKE '%...' AND kind = 'TODO'`                     |
| Most complex files        | `SELECT from_path, COUNT(*) as deps FROM dependencies GROUP BY from_path ORDER BY deps DESC LIMIT 10`        |
| CSS design tokens         | `SELECT name, value, scope FROM css_variables WHERE name LIKE '--%...'`                                      |
| CSS module classes        | `SELECT name, file_path FROM css_classes WHERE is_module = 1`                                                |
| CSS keyframes             | `SELECT name, file_path FROM css_keyframes`                                                                  |
| Type/interface shape      | `SELECT name, type, is_optional, is_readonly FROM type_members WHERE symbol_name = '...'`                    |
| Deprecated symbols        | `SELECT name, kind, file_path, doc_comment FROM symbols WHERE doc_comment LIKE '%@deprecated%'`              |
| Visibility-tagged symbols | `SELECT name, kind, visibility, file_path FROM symbols WHERE visibility IS NOT NULL` (or `= 'beta'`, etc.)   |
| Symbol docs               | `SELECT name, signature, doc_comment FROM symbols WHERE name = '...' AND doc_comment IS NOT NULL`            |
| Const values              | `SELECT name, value, file_path FROM symbols WHERE kind = 'const' AND value IS NOT NULL AND name LIKE '%...'` |
| Class members             | `SELECT name, kind, signature FROM symbols WHERE parent_name = '...'`                                        |
| Top-level only            | `SELECT name, kind, signature FROM symbols WHERE parent_name IS NULL AND file_path LIKE '%...'`              |
| Who calls X?              | `SELECT DISTINCT caller_name, file_path FROM calls WHERE callee_name = '...'`                                |
| What does X call?         | `SELECT DISTINCT callee_name FROM calls WHERE caller_name = '...'`                                           |
| Call hotspots             | `SELECT callee_name, COUNT(*) as fan_in FROM calls GROUP BY callee_name ORDER BY fan_in DESC LIMIT 10`       |

**Use `DISTINCT`** on dependency and import queries — a file importing multiple specifiers from the same module produces duplicate rows.

For the full schema, advanced query patterns, and troubleshooting, read the skill at `.agents/skills/codemap/SKILL.md`.

## Keeping it fresh

**After completing a step that modified source files, re-index before making any further queries.** The index only reflects the state at the time it was last built — edits you just made won't appear until you re-index.

```bash
# Targeted — re-index only the files you just touched
bun src/index.ts --files path/to/file1.tsx path/to/file2.ts

# Incremental — auto-detects changed files via git
bun src/index.ts

# Full rebuild — after rebase, branch switch, or stale index
bun src/index.ts --full
```

### When to re-index

- **After editing files** — use `--files` with the paths you modified (fastest). Deleted files are auto-detected and removed from the index
- **After switching branches or rebasing** — run `--full`
- **When unsure which files changed** — run without flags to auto-detect via git
