## Agent-friendly SQL recipes

Replace placeholders (`'...'`) with your module path, file glob, or symbol name.

**Outcome aliases:** **`codemap dead-code`** · **`deprecated`** · **`boundaries`** · **`hotspots`** · **`coverage-gaps`** — thin wrappers over `query --recipe <id>`. Every `query` flag passes through (`--json`, `--format sarif`, `--ci`, `--summary`, `--changed-since`, `--group-by`, `--params`, `--save-baseline`, `--baseline`). Run **`codemap <alias> --help`** for the wrapped recipe id. Capped at 5 to avoid sprawl.

**Suppressions (opt-in):** `// codemap-ignore-next-line <recipe-id>` and `// codemap-ignore-file <recipe-id>` (also `#`, `--`, `<!--`, `/*` leaders) get parsed into the `suppressions(file_path, line_number, recipe_id)` table. Recipe authors opt in by `LEFT JOIN`-ing on `(file_path, recipe_id)` with `line_number = 0` for file scope or `line_number = <row's line>` for next-line. Ad-hoc SQL is unaffected. No severity, no suppression-by-default, no universal-honor — consumer-chosen substrate. Today's opt-in recipes: `untested-and-dead` (line + file), `unimported-exports` (file only — exports has no `line_number`).

**CLI shortcuts:** **`codemap query --json --recipe <id>`** runs bundled SQL (preferred for agents). **`codemap query --recipe <id>`** without **`--json`** prints a table. **`codemap query --recipes-json`** prints every bundled recipe (**`id`**, **`description`**, **`sql`**, optional **`actions`**, plus **`last_run_at`** + **`run_count`** recency fields) as JSON (no DB required for the catalog itself; recency populates when an indexed DB exists, otherwise null/0). **`codemap query --print-sql <id>`** prints one recipe's SQL only. **The auto-generated table below enumerates every recipe id this codemap ships** — refer to that table for canonical id, source (bundled / project), params, and description.

**Output flags** (compose with **`--recipe`** or ad-hoc SQL):

- **`--summary`** — counts only. With **`--json`**: **`{"count": N}`**. With **`--group-by`**: **`{"group_by": "<mode>", "groups": [{key, count}]}`**.
- **`--changed-since <ref>`** — post-filter rows by **`path`** / **`file_path`** / **`from_path`** / **`to_path`** / **`resolved_path`** against **`git diff --name-only <ref>...HEAD ∪ git status --porcelain`**. Rows with no recognised path column pass through.
- **`--group-by owner|directory|package`** — partition into buckets and emit **`{"group_by", "groups": [{key, count, rows}]}`**. **`owner`** reads CODEOWNERS (last matching rule wins); **`directory`** is the first path segment; **`package`** uses **`package.json`** **`workspaces`** or **`pnpm-workspace.yaml`**. **Mutually exclusive with `--save-baseline` / `--baseline`.**
- **`--save-baseline[=<name>]`** — snapshot the result rows to the **`query_baselines`** table inside `<state-dir>/index.db` (default `.codemap/index.db`; no parallel JSON files; survives `--full` and SCHEMA bumps). Name defaults to the `--recipe` id; ad-hoc SQL needs an explicit `=<name>`. Re-saving with the same name overwrites in place.
- **`--baseline[=<name>]`** — diff the current result against the saved baseline. Output `{baseline:{...}, current_row_count, added: [...], removed: [...]}` (with `--json`) or a two-section terminal dump. Identity = per-row multiset equality (canonical `JSON.stringify` keyed frequency map; duplicates preserved). Pair with `--summary` for `{baseline:{...}, current_row_count, added: N, removed: N}`. **Mutually exclusive with `--group-by`.**
- **`--baselines`** lists saved baselines (no `rows_json` payload); **`--drop-baseline <name>`** deletes one. Both reject every other flag — they're list-only / drop-only operations.
- **Per-row recipe `actions`** — recipes that define an **`actions: [{type, auto_fixable?, description?}]`** template append it to every row in **`--json`** output (recipe-only; ad-hoc SQL never carries actions). Under `--baseline`, actions attach to the **`added`** rows only (the rows the agent should act on). Inspect via **`--recipes-json`**.
- **Boundary violations (config-driven)** — declare `boundaries: [{name, from_glob, to_glob, action?}]` in `.codemap/config.ts` and run `codemap query --recipe boundary-violations [--format sarif]`. The `action` field defaults to `"deny"` (the only shape v1 surfaces); rules are reconciled into the `boundary_rules` table on every index pass and joined against `dependencies` via SQLite `GLOB`.
- **Project-local recipes** — drop **`<id>.sql`** (and optional **`<id>.md`** for description body, params, and actions) into **`<state-dir>/recipes/`** (default `.codemap/recipes/`; honors `--state-dir` / `CODEMAP_STATE_DIR`) to make team-internal SQL a first-class CLI verb. `--recipes-json` and the `codemap://recipes` MCP resource list project recipes alongside bundled ones with **`source: "bundled" | "project"`** discriminating them. Project recipes win on id collision; entries that override a bundled id carry **`shadows: true`** so agents reading the catalog at session start know when a recipe behaves differently from the documented bundled version. `<id>.md` supports YAML frontmatter for `params:` and per-row `actions:` — **block-list shape only** (loader's hand-rolled parser; no inline-flow `[{...}]`). Param types: `string | number | boolean`; pass values with `--params key=value[,key=value]` (repeatable; last value wins). Example: `codemap query --json --recipe find-symbol-by-kind --params kind=function,name_pattern=%Query%`. Validation: SQL is rejected at load time if it starts with DML/DDL (DELETE/DROP/UPDATE/etc.); params validate before SQL binding; runtime `PRAGMA query_only=1` is the parser-proof backstop. `<state-dir>/index.db` is gitignored; **`<state-dir>/recipes/` is NOT** — recipes are git-tracked source code authored for human review.

**Audit (`codemap audit`)** — separate top-level command for structural-drift verdicts. Composes baselines into a per-delta `{head, deltas}` envelope; v1 ships `files` / `dependencies` / `deprecated`. Two snapshot-source shapes:

- **`--baseline <prefix>`** — auto-resolves `<prefix>-files` / `<prefix>-dependencies` / `<prefix>-deprecated` in `query_baselines`. Slots that don't exist are silently absent. **If no slot resolves at all** (every auto-resolved name is missing AND no `--<delta>-baseline` flag is passed), audit exits 1 — never produces an empty envelope.
- **`--<delta>-baseline <name>`** — explicit per-delta override (e.g. `--files-baseline X --dependencies-baseline Y`). Names must exist or audit exits 1. Composes with `--baseline` (per-delta flag overrides one slot).

Each emitted delta carries its own `base` metadata so mixed-baseline audits are first-class. `--summary` collapses each delta to `{added: N, removed: N}`. `--no-index` skips the auto-incremental-index prelude (default is to re-index first so `head` reflects current source). v1 ships no `verdict` / threshold config — `codemap audit --json | jq -e '.deltas.dependencies.added | length <= 50'` is the CI exit-code idiom until v1.x ships native thresholds. Each delta pins a canonical SQL projection and validates baseline column-set membership before diffing — schema-bump-resilient (extras dropped, missing columns surface a clean re-save command).

**MCP server (`codemap mcp [--no-watch] [--debounce <ms>]`)** — separate top-level command that exposes the entire CLI surface to agent hosts (Claude Code, Cursor, Codex, generic MCP clients) as JSON-RPC tools over stdio. Eliminates the bash round-trip on every agent call. Bootstrap once at server boot; tool handlers reuse the existing engine entry-points so output shape is verbatim from each tool's CLI counterpart's `--json` envelope. **Watcher default-ON since 2026-05** — every tool reads a live index, `audit`'s incremental-index prelude becomes a no-op. Pass `--no-watch` (or `CODEMAP_WATCH=0`) for one-shot fire-and-forget calls without spawning the chokidar co-process.

**HTTP server (`codemap serve [--host 127.0.0.1] [--port 7878] [--token <secret>] [--no-watch] [--debounce <ms>]`)** — same tool taxonomy as MCP, exposed over `POST /tool/{name}` for non-MCP consumers (CI scripts, simple `curl`, IDE plugins that don't speak MCP). Loopback-default; optional Bearer-token auth. Output shape is the `codemap query --json` envelope (NOT MCP's `{content: [...]}` wrapper); SARIF / annotations payloads ship with `application/sarif+json` / `text/plain` Content-Type. Resources mirrored at `GET /resources/{encoded-uri}`. `GET /health` is auth-exempt; `GET /tools` / `GET /resources` are catalogs. **Watcher default-ON since 2026-05** — same `--no-watch` / `CODEMAP_WATCH=0` opt-out as `mcp`.

**Watch mode (`codemap watch [--debounce 250] [--quiet]`)** — standalone long-running process that debounces file changes and re-indexes only the changed paths. SIGINT/SIGTERM drains pending edits before exit. `mcp` / `serve` boot the watcher in-process by default since 2026-05; use `codemap watch` standalone when you want the watcher decoupled from a transport (e.g. running alongside an editor that already speaks MCP via a different process).

**Tools** — snake_case keys (Codemap convention; CLI stays kebab — translation at the MCP arg layer). Every tool returns the same JSON envelope its CLI counterpart's `--json` prints. Run `codemap <verb> --help` (or `query_recipe --recipes-json` / the CLI verb's docs) for the authoritative parameter list and result shape; the entries below are existence + transport notes only.

- **`query`** — `{sql, summary?, changed_since?, group_by?, format?}`. One read-only SQL. `format` accepts `sarif | annotations | mermaid | diff | diff-json` (incompatible with `summary` / `group_by`).
- **`query_batch`** — **MCP-only** (no CLI). `{statements: (string | {sql, summary?, changed_since?, group_by?})[]}`. N statements / one round-trip; per-statement errors isolated.
- **`query_recipe`** — `{recipe, params?, summary?, changed_since?, group_by?, format?}`. Resolves a recipe id to SQL + params + per-row actions, then executes. Unknown id → structured `{error}` pointing at `codemap://recipes`.
- **`audit`** — `{base?, baseline_prefix?, baselines?, summary?, no_index?}`. Composes snapshot sources into `{head, deltas}`. `base` (git committish, sha-keyed cache) and `baseline_prefix` are mutually exclusive; per-delta `baselines` overrides compose with either.
- **`save_baseline`** — polymorphic `{name, sql? | recipe?}` (exactly one of `sql` / `recipe`).
- **`list_baselines`** — no args; returns the array `codemap query --baselines --json` would print.
- **`drop_baseline`** — `{name}` → `{dropped}` or `isError` if unknown.
- **`context`** — `{compact?, intent?}`. Session-start project envelope (one call replaces 4-5 `query`s).
- **`validate`** — `{paths?: string[]}`. SHA-256 vs `files.content_hash`; rows return `ok` / `stale` / `missing` / `unindexed`.
- **`show`** — `{name, kind?, in?}` or `{query, with_fts?}`. Exact symbol lookup or field-qualified search (`kind:`, `name:`, `path:`, `in:` + free text) → `{matches, disambiguation?}`. CLI: `codemap show --query '…' [--print-sql]`.
- **`snippet`** — same shape as `show` but each match also carries `source` (file text) + `stale` / `missing` flags. No reindex side-effects.
- **`impact`** — `{target, direction?, via?, depth?, limit?, summary?}`. Symbol/file blast-radius walker (replaces hand-composed `WITH RECURSIVE`). Auto-resolves symbol vs file target; `via` defaults to every backend compatible with the kind.
- **`trace`** — `{from, to, max_depth?, via?, budget_chars?}`. Shortest call path + budget-capped snippets (`call-path` recipe twin). `truncated` when snippet budget hit (`truncation.snippets`); dependency hops set `snippets_skipped_reason` instead of auto-snippets.
- **`explore`** — `{names, depth?, kind?, budget_chars?}`. Multi-name neighborhood survey + snippets (`symbol-neighborhood` per deduped name). `truncated` when row cap (500) and/or snippet budget hit (`truncation.rows` / `truncation.snippets`).
- **`node`** — `{name, kind?, in?, include_snippets?, budget_chars?}`. `show` center + scoped depth-1 neighborhood; optional center+neighbor snippets when `include_snippets: true` (`truncated` / `truncation.snippets` only then).
- **`affected`** — `{paths?, changed_since?, test_glob?, max_depth?}`. Reverse-dependency walk from changed files to test paths (same preprocessor as **`codemap affected`** → **`affected-tests`** recipe). Explicit `paths` (including `paths: []` for empty — skips git) wins over git discovery; omit `paths` for working tree vs `changed_since` (default `HEAD`). When both `paths` and `changed_since` are sent, `paths` wins (mirrors CLI positional + `--changed-since`).
- **`apply`** — `{recipe, params?, dry_run?, yes?}`. Executes the diff hunks a recipe row produces (`{file_path, line_start, before_pattern, after_pattern}`). **All-or-nothing**: any conflict aborts before any file is written. Over MCP/HTTP `yes: true` is required for the write path; `dry_run` and `yes` are mutually exclusive.

**Affected tests:** **`codemap affected`** (CLI) for CI/shell (`stdin`, `--changed-since`). **`affected`** MCP/HTTP tool or **`query_recipe`** with `recipe: "affected-tests"` for agents. Path sources on CLI: positional → `--stdin` → `--changed-since` → default `HEAD`. On MCP/HTTP: `paths` array → else `changed_since` / `HEAD`. Example:

```bash
codemap affected --json
git diff --name-only origin/main | codemap affected --stdin --json
# MCP/HTTP: affected { paths: ["src/foo.ts"] }  — or query_recipe fallback:
codemap query --json --recipe affected-tests --params changed_files=src/foo.ts
```

**Resources** — same URI set over MCP **and** HTTP (`GET /resources/{encoded-uri}` against `codemap serve`); shared `readResource()` handler so bodies are identical. Catalog / static resources lazy-cache once per process; recipes + per-file / per-symbol lookups read live so inline recency fields stay fresh.

- **`codemap://recipes`** — full catalog (same as `--recipes-json`). Each row carries `source: "bundled" | "project"`, optional `shadows: true`, plus `last_run_at` / `run_count` recency fields.
- **`codemap://recipes/{id}`** — one recipe `{id, description, body?, sql, actions?, source, shadows?, last_run_at, run_count}` (replaces `--print-sql <id>`).
- **`codemap://schema`** — live DDL of every table in `<state-dir>/index.db` (default `.codemap/index.db`; also embedded inline below).
- **`codemap://skill`** / **`codemap://rule`** — full text of this skill / the codemap rule. Same content `codemap skill` / `codemap rule` print.
- **`codemap://mcp-instructions`** — MCP initialize tool-selection playbook (also injected as `instructions` on handshake).
- **`codemap://files/{path}`** — per-file roll-up `{path, language, line_count, symbols, imports, exports, coverage}`; URI-encode path segments (MCP template uses `{+path}`). Live.
- **`codemap://symbols/{name}`** — exact-name lookup → `{matches, disambiguation?}` (same as `show`); optional `?in=<path-prefix>` filter. Live.

**Launching:** point your agent host at `codemap mcp` as the stdio command. Most hosts (Claude Code, Cursor, Codex) accept `{command: "codemap", args: ["mcp"], cwd: "/path/to/project"}`. The server inherits `cwd` as the project root unless `--root` overrides it.

**Determinism:** Bundled recipes use stable secondary **`ORDER BY`** tie-breakers (and ordered inner **`LIMIT`** samples where applicable). Prefer **`--recipe`** over pasting SQL when you need the maintained ordering. **Canonical SQL** is whatever **`codemap query --print-sql <id>`** or **`codemap query --recipes-json`** returns (single source in the CLI).

**Example: top files by dependency fan-out** (`fan-out`):

```sql
SELECT from_path, COUNT(*) AS deps
FROM dependencies
GROUP BY from_path
ORDER BY deps DESC, from_path ASC
LIMIT 10
```

**Same ranking, plus up to five sample targets per file** (`fan-out-sample`):

```sql
SELECT d.from_path,
  COUNT(*) AS deps,
  (SELECT GROUP_CONCAT(to_path, ' | ')
   FROM (SELECT to_path FROM dependencies d2 WHERE d2.from_path = d.from_path ORDER BY to_path ASC LIMIT 5))
    AS sample_targets
FROM dependencies d
GROUP BY d.from_path
ORDER BY deps DESC, d.from_path ASC
LIMIT 10
```

**JSON array samples (JSON1):** use **`codemap query --json --recipe fan-out-sample-json`** — or replace **`GROUP_CONCAT`** with **`json_group_array(to_path)`** in the inner subquery if your SQLite build has JSON1.
