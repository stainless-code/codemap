# DX Improvements — Research

Candidates for improving developer experience, agent ergonomics, and tooling.

---

## 1. `.agents/lessons.md` convention

**Type:** Doc | **Effort:** ~10 min

Add a persistent lessons file that agents update after corrections. Prevents repeating the same mistakes across sessions. Convention: agents check it before starting, append after corrections.

---

## 2. `--performance` CLI flag

**Type:** Code | **Effort:** ~2-4 hr

Instrument key phases (glob, parse, resolve, insert, index creation) with `perf_hooks` timerify. A `--performance` flag prints a timing breakdown after indexing. Helps users and devs diagnose slow runs without external profiling tools.

Current state: `index-engine.ts` already captures total elapsed ms via `performance.now()`, and `benchmark.ts` measures query speed and reindex speed externally. The gap is per-phase granularity from the CLI itself.

---

## 3. Adapter scaffolding script

**Type:** Code | **Effort:** ~2-4 hr

`codemap create-adapter --name [name]` generates boilerplate for a community language adapter: adapter file, test file, fixture directory. Lowers the barrier for contributors building adapters for new languages.

Prerequisite: community adapter registration API (on roadmap). Scaffolding could land independently with a manual registration step if the API isn't ready.

---

## 4. AST-based config resolution

**Type:** Code | **Effort:** ~2-4 hr

For `codemap.config.ts`, consider AST-based extraction (via `oxc-parser`, already a dependency) instead of executing the config with native `import()` (ESM dynamic import). Faster, no side effects, safer in untrusted repos. JSON configs are already safe.

Trade-off: AST-based can't handle dynamic configs (the current loader supports async functions returning config). Could offer both paths — AST-first with `import()` fallback.

---

## 5. Watch mode

**Type:** Code | **Effort:** ~4-8 hr | **Status:** On roadmap backlog

`node:fs.watch` with `{ recursive: true }` + incremental re-index of changed files. The existing incremental/targeted model (`--files`) already supports the core loop — the gap is the file-watching shell and session management.

Platform note: `recursive: true` on Linux requires Node 19.1+ and behaves differently from macOS FSEvents — may need a fallback or documented minimum.

---

## 6. MCP server wrapping `query`

**Type:** Code | **Effort:** ~4-8 hr | **Status:** On roadmap backlog

Expose `query` as an MCP tool so agents in any IDE can run SQL against the index without shell access. Minimal surface: one tool (run SQL, return rows). Could be a separate entry point or package.

---

## 7. Monorepo / workspace awareness

**Type:** Code | **Effort:** ~8+ hr | **Status:** On roadmap backlog

Discover workspaces from `pnpm-workspace.yaml` / `package.json` workspaces and index per-workspace dependency graphs. Currently Codemap indexes one root — workspace-aware indexing would give more precise `dependencies` edges in monorepos.
