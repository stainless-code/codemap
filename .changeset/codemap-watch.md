---
"@stainless-code/codemap": minor
---

`codemap watch` — long-running process that re-indexes changed files in real time so every CLI / MCP / HTTP query reads live data without a per-query reindex prelude. Eliminates the single biggest source of agent-side friction: "is the index stale right now?"

**Three shapes:**

- **Standalone**: `codemap watch [--debounce 250] [--quiet]` — foreground process; logs `reindex N file(s) in Mms` per batch unless `--quiet`. SIGINT / SIGTERM drains pending edits.
- **MCP killer combo**: `codemap mcp --watch [--debounce <ms>]` — boots stdio MCP server + watcher in one process. Long Cursor / Claude Code sessions never hit a stale index; agents stop having to remember to reindex between edit + query.
- **HTTP killer combo**: `codemap serve --watch [--debounce <ms>]` — same shape for non-MCP consumers (CI scripts, IDE plugins, simple `curl`).

**Audit prelude optimization:** when watch is active, `mcp audit`'s default incremental-index prelude becomes a no-op (the watcher already keeps the index fresh — saves the per-request reindex cost). Explicit `no_index: false` still forces the prelude.

**Env shortcut:** `CODEMAP_WATCH=1` (or `"true"`) implies `--watch` for `mcp` / `serve` — useful for IDE / CI launches that can't easily edit the spawn command.

**Backend:** [chokidar v5](https://github.com/paulmillr/chokidar) (selected via 6-watcher audit in PR #46). Pure JS — runs identically on Bun + Node, no per-runtime branching, no native compile matrix on top of `bun:sqlite` / `better-sqlite3`. Cross-platform (macOS / Linux / Windows / WSL). Atomic-write + chunked-write detection out of the box. 1 dep (`readdirp`), 82 KB.

**Filtering:** Only paths the indexer cares about trigger a reindex (TS / TSX / JS / JSX / CSS + project-local recipes under `<root>/.codemap/recipes/`). `node_modules` / `.git` / `dist` / configured `excludeDirNames` are skipped.
