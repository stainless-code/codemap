# `codemap watch` — keep `.codemap.db` fresh on file change

> **Status:** in design (no code) · **Backlog:** [`docs/roadmap.md` § Backlog](../roadmap.md#backlog) (Watch mode for dev). Delete this file when shipped (per [`docs/README.md` Rule 3](../README.md)).

## Goal

Eliminate the single biggest source of agent-side friction: "is the index stale right now?" Today every CLI / MCP / HTTP query returns whatever was in `.codemap.db` at boot — wrong after the first edit. Watch mode runs a long-lived process that re-indexes changed files in real time so reads are always fresh, no per-query prelude needed.

Killer combo: **`codemap mcp --watch`** / **`codemap serve --watch`** — one process, always fresh, zero-friction agent reads (see [§ Agent-experience win](#agent-experience-win) below).

## Agent-experience win

| Today                                                                                                                                     | With watch mode                                       |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Agent must remember to `codemap` (incremental reindex) before any structural query touching just-edited code, or read stale data silently | Index is live; `query` always reads what's on disk    |
| MCP `audit` tool defaults to running an incremental-index prelude per request (because it MUST be fresh) — wasteful on every call         | Prelude becomes a no-op; `audit` reads the live index |
| Long Cursor / Claude Code sessions degrade silently — every query past the first edit is against stale rows                               | Index streams alongside the session                   |
| Multi-step refactor flows (rename `foo` → `bar` then check who still calls `foo`) require manual reindex between steps                    | Edit → query, no manual step                          |
| Defensive `validate` calls before structural reads (per the skill's "verify-then-act" pattern)                                            | `validate` becomes diagnostic-only                    |

## Library evaluation

Six candidates audited for **speed**, **robustness**, **OS coverage** (macOS, Linux, Windows, WSL), **JS runtime coverage** (Node + Bun), and **install footprint**. Codemap currently runs on Bun + Node 20+ and ships as a single CLI; native bindings are tolerable (we have `bun:sqlite` / `better-sqlite3` already) but each one adds prebuild matrices.

### Matrix

| Library                                                                 | Latest                         | Approach                                                                                | Deps                           | Bundle                  | macOS      | Linux                                                                                                                        | Windows | Bun                                                                                                                                                                                                                                                                       | Node                | Maintenance                                                                   |
| ----------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------ | ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| **[chokidar](https://github.com/paulmillr/chokidar) v5**                | Nov 2025                       | JS wrapper over `fs.watch` + polling fallback                                           | 1 (readdirp)                   | 82 KB                   | ✓          | ✓                                                                                                                            | ✓       | ✓                                                                                                                                                                                                                                                                         | ≥20.19              | 12.1k★ · paulmillr · used by ~30M repos                                       |
| **[@parcel/watcher](https://github.com/parcel-bundler/watcher) v2.5.6** | Jan 2026                       | Native C++; FSEvents / Watchman / inotify / ReadDirectoryChangesW / kqueue              | ~17 incl. 13 platform binaries | 100 KB JS + N MB binary | ✓ FSEvents | ✓ inotify (faster w/ Watchman)                                                                                               | ✓ RDCW  | ⚠️ N-API compat varies                                                                                                                                                                                                                                                    | ✓                   | 770★ · devongovett · Parcel/VSCode/Tailwind/Gatsby/Nx                         |
| **[nsfw](https://github.com/axosoft/nsfw) v2.2.5**                      | Aug 2024 release; commits 2026 | Native C++; FSEvents / inotify / RDCW                                                   | 1                              | ~70 KB + binary         | ✓          | ✓                                                                                                                            | ✓       | ⚠️ node-gyp toolchain                                                                                                                                                                                                                                                     | ✓                   | 924★ · GitKraken · **stagnant** (no release in ~16 mo despite recent commits) |
| **[watchpack](https://github.com/webpack/watchpack) v2.5.1**            | Jan 2026                       | JS wrapper (uses chokidar internally + dedup / aggregation)                             | 2                              | 93 KB                   | ✓          | ✓                                                                                                                            | ✓       | ✓                                                                                                                                                                                                                                                                         | ✓                   | 397★ · sokra (webpack) · 43.8M weekly downloads                               |
| **[turbowatch](https://github.com/gajus/turbowatch) v2.30.0**           | Jan 2026                       | Trigger-based; defaults to `fs.watch` on macOS + chokidar elsewhere; pluggable backends | 15                             | 263 KB                  | ✓          | ✓                                                                                                                            | ✓       | ✓                                                                                                                                                                                                                                                                         | ✓                   | 973★ · gajus · 4 contributors (bus factor)                                    |
| **`node:fs.watch`**                                                     | built-in                       | Built-in `fs.watch` (FSEvents / inotify / RDCW under libuv)                             | 0                              | 0                       | ✓          | ⚠️ Linux recursive is a JS polyfill, race-condition-prone ([nodejs/node#48437](https://github.com/nodejs/node/issues/48437)) | ✓       | ⚠️ active bugs in 2026 ([oven-sh/bun#15085](https://github.com/oven-sh/bun/issues/15085), [#18919](https://github.com/oven-sh/bun/issues/18919), [#24875](https://github.com/oven-sh/bun/issues/24875), [PR #28290](https://github.com/oven-sh/bun/pull/28290) in review) | ≥19.1 for recursive | core                                                                          |

### Per-library notes

#### chokidar v5 ([npm](https://npmx.dev/package/chokidar) · [GH](https://github.com/paulmillr/chokidar))

Pure-JS abstraction over `fs.watch` / `fs.watchFile`. Normalizes events across OSes (macOS reports filenames properly, no double-fire, atomic-write detection). 14-year bug-hunt history; v5 (Nov 2025) is ESM-only with Node ≥20.19. Single dep (`readdirp`). Includes `awaitWriteFinish` (poll size until stable — handles editors that write in chunks), `atomic` (re-add within 100ms collapses to `change`), recursive depth limit, glob ignore.

**For codemap:** ✓ cross-runtime (pure JS works identically on Bun + Node — no N-API surprises). ✓ Battle-tested across 30M repos. ✓ Smallest dep footprint of the abstractions. **One drawback:** slower than `@parcel/watcher` on `npm install`-scale bursts (no C++ throttling); irrelevant for codemap's editor-pace use case after debounce.

#### @parcel/watcher v2.5.6 ([npm](https://registry.npmjs.org/%40parcel%2Fwatcher) · [GH](https://github.com/parcel-bundler/watcher))

Native C++ N-API bindings. Ships per-platform packages: `darwin-{x64,arm64}` · `win32-{x64,arm64,ia32}` · `linux-{x64,arm64,arm}-{glibc,musl}` · `android-arm64` · `freebsd-x64`. Throttling happens in C++ so the JS thread doesn't get overwhelmed during `git checkout` / `npm install`. Fastest for large trees; on Linux can use Watchman if installed for FSEvents-class perf.

**For codemap:** ✓ Best perf. ✗ Native binary per (OS, arch) bloats install matrix (we'd inherit 13 platform packages on top of `bun:sqlite` / `better-sqlite3`'s already-large prebuild story). ✗ N-API compat with Bun is partial — these specific bindings have known quirks. ✗ We don't need the perf — codemap watches a project root with debounced reindex, not millions of files.

#### nsfw v2.2.5 ([npm](https://www.npmjs.com/package/nsfw) · [GH](https://github.com/axosoft/nsfw))

Native C++, GitKraken's. Recursive watching at the C++ layer. Last release Aug 2024 (~16 months ago at this writing) despite commits in 2026 — release cadence stagnant. Requires `node-gyp` toolchain on platforms without a prebuild.

**For codemap:** ✗ Stagnant releases is a yellow flag for an OS-spanning native dep. ✗ `node-gyp` requirement is a non-starter for users without build tools (especially on Windows). Skip.

#### watchpack v2.5.1 ([npm](https://registry.npmjs.org/watchpack) · [GH](https://github.com/webpack/watchpack))

Webpack's watcher. 43.8M weekly downloads — heaviest battle-testing of any candidate. Pure JS, 2 deps. Three-level architecture (`Watcher` → `DirectoryWatcher` → real watcher) ensures one watcher per directory regardless of how many files map onto it; reference-counted cleanup. Has built-in `aggregateTimeout` (debounce — fires `aggregated` event after N ms of quiet).

**For codemap:** ✓ Pure JS, runs on Bun + Node. ✓ Built-in aggregation matches what we need (debounce changed-files set, then call `--files <set>` reindex). ✗ API is webpack-shaped (`{files, directories, missing}` triple + `startTime` for "watch from a past timestamp"); useful for build pipelines but extra cognitive load for our use case. ✗ Internally builds on chokidar in some configurations — we'd be wrapping a wrapper.

#### turbowatch v2.30.0 ([npm](https://registry.npmjs.org/turbowatch) · [GH](https://github.com/gajus/turbowatch))

Trigger-based DSL ("when files matching X change, run command Y"). Defaults to `fs.watch` on macOS + chokidar elsewhere. Originally built for Watchman but fell back to chokidar after symlink limitations ([#105](https://github.com/gajus/turbowatch/issues/105)).

**For codemap:** ✗ Heavy: 15 deps including `chalk`, `roarr`, `randomcolor`, `zx`. ✗ The trigger DSL fights us — codemap wants "file changed → call function" not "file changed → exec command". ✗ Effectively chokidar with extra layers. ✗ 4 contributors (bus factor). Skip.

#### `node:fs.watch` (built-in)

Cross-runtime baseline. Macros over libuv's `uv_fs_event_*`. Linux recursive support added in Node 19.1 — but it's a Linux-only JS polyfill (`lib/internal/fs/recursive_watch.js`) that opens an inotify watch per file (vs per-directory in libuv), explicitly marked as a stopgap (`// TODO: Remove non-native watcher when/if libuv supports recursive`). Race condition between the polyfill's async traverse and the watch setup ([nodejs/node#48437](https://github.com/nodejs/node/issues/48437)). Bun has its own active bugs through 2026 ([oven-sh/bun#15085](https://github.com/oven-sh/bun/issues/15085) — files created after watch start are blind spots; [#18919](https://github.com/oven-sh/bun/issues/18919) — fs.watch dies after `.close()`; [#24875](https://github.com/oven-sh/bun/issues/24875) — delete+recreate breaks `change` events; [PR #28290](https://github.com/oven-sh/bun/pull/28290) is the in-progress libuv-alignment refactor as of 2026-04).

**For codemap:** ✗ Linux recursive polyfill burns `max_user_watches` (one inotify slot per file vs per directory in libuv — see [Bun PR #28290](https://github.com/oven-sh/bun/pull/28290) discussion). ✗ Bun bugs would force per-runtime workarounds. ✗ Per-platform behavior differences mean we'd reimplement chokidar's abstraction layer. Skip the bare path.

## Decision

**chokidar v5.**

Why it wins for codemap specifically:

1. **Cross-runtime parity.** Pure JS — Bun + Node behave identically. No N-API compat questions, no per-runtime watcher selection.
2. **Cross-OS robustness.** macOS / Linux / Windows / WSL all handled by the same code. 30M repos = the bug surface is well-explored.
3. **Smallest install footprint of the JS abstractions.** 82 KB + 1 dep (`readdirp`). Doesn't add a native compile matrix on top of our SQLite native deps.
4. **Right perf bracket.** Watcher fires events as edits happen; we debounce 200-500 ms then call `runCodemapIndex({mode: 'targeted', files: [...changed]})`. We don't need C++ throttling for editor-pace events; the bursts that DO happen (`git checkout`, `npm install`) we want to coalesce anyway.
5. **Atomic-write detection** out of the box (`atomic: true`). Editors that mv-replace (vim, IntelliJ, several IDEs) don't trigger spurious `unlink`+`add`.
6. **`awaitWriteFinish`** for chunked writes (large auto-generated files, e.g. `pnpm-lock.yaml` rewrites).
7. **Active maintenance.** v5 (Nov 2025), Node ≥20.19 alignment, ESM-only — matches codemap's stack.

**`@parcel/watcher` is a defensible alternative** if we ever measure chokidar's perf as a bottleneck on monorepo-scale repos (>100k files). Defer that decision to data; default to chokidar.

## Sketched API

CLI surface (mirrors existing patterns):

```bash
codemap watch [--root DIR] [--config FILE] [--debounce MS]
              [--quiet]   # no per-event log lines; just startup + errors
              [--files only<glob>]   # optional narrowing (defaults to project glob)
codemap serve --watch     # boot HTTP server + start watcher in one process
codemap mcp   --watch     # boot MCP stdio + start watcher in one process
```

Environment:

- `CODEMAP_WATCH=1` — implicit `--watch` for `serve` / `mcp` (CI / IDE integration shortcut).
- `CODEMAP_WATCH_DEBOUNCE` — override default debounce.

What it watches:

- The project root (already discovered via `--root` / `CODEMAP_ROOT`).
- Same glob the indexer uses (TS / TSX / JS / JSX / CSS / `templates/recipes/*` / `<root>/.codemap/recipes/*`).
- Same ignore set the indexer uses (`node_modules`, `.git`, `dist`, `.codemap.db`, `.codemap-wal`, `.codemap-shm`).

What it does on event:

1. Coalesce all `add` / `change` / `unlink` events for `--debounce` ms (default 250 ms).
2. Filter to project-relative POSIX paths that match the indexer's glob.
3. Call `runCodemapIndex({mode: 'targeted', files: [...changedSet]})`.
4. On `unlink`, the targeted reindex path already deletes orphaned rows.
5. Emit a one-line status (`reindex: 7 files in 84ms`) to stderr unless `--quiet`.

Implementation seam:

- New `src/cli/cmd-watch.ts` (parser + bootstrap + run loop).
- New `src/application/watcher.ts` (pure transport-agnostic — `runWatchLoop({root, debounceMs, onChange})` accepting an injected `onChange` callback so tests can drive it without a real chokidar instance).
- `serve` / `mcp` add a `--watch` flag that runs the watch loop alongside their existing transport.
- Reuses `runCodemapIndex` from `src/application/run-index.ts` unchanged.

Tracer plan:

| #   | Slice                                                                                                                                                                                                             | Acceptance                                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | `src/application/watcher.ts` skeleton — pure debouncer + glob filter; injectable backend so tests don't need real fs                                                                                              | Unit tests for debounce coalescing, glob include/exclude, unlink propagation                                      |
| 2   | `cmd-watch.ts` parser + bootstrap; wires real chokidar instance to the watcher engine; foreground process (logs to stderr, ctrl-c drain)                                                                          | `bun src/index.ts watch` boots, logs reindex events, exits cleanly on SIGINT                                      |
| 3   | `serve --watch` / `mcp --watch` integration — one process                                                                                                                                                         | `codemap serve --watch` boots HTTP + starts watcher; queries return fresh data after edits without manual reindex |
| 4   | Index prelude removal — `mcp audit`'s default `no_index: true` becomes unnecessary when launched with `--watch`; document the optimization                                                                        | Audit handler skips the prelude when watcher is active                                                            |
| 5   | Docs sync (README CLI stripe, architecture.md § Watch wiring, glossary `watch`, agent rule + skill in `.agents/` + `templates/agents/` per Rule 10), changeset (minor — new top-level CLI verb), delete this plan | All docs updated; plan deleted                                                                                    |

## Out of scope

- **Polling fallback.** chokidar exposes `usePolling: true` for network mounts; expose only via env var (`CODEMAP_WATCH_POLLING=1`) — defer to a real consumer asking.
- **Daemon-style detached process.** Watch mode is foreground (or in-process with `serve`/`mcp`); no `--detach` / pidfile / unix socket. Codemap explicitly rejects the persistent-daemon thesis ([roadmap § Non-goals](../roadmap.md#non-goals-v1)) — `serve --watch` is the on-purpose long-running shape.
- **Cross-host watching.** Single project root per process (matches `serve` / `mcp`).
- **Watch-driven `query` push notifications.** No SSE / WS yet; clients re-query on their own cadence. Revisit if a real consumer asks.
