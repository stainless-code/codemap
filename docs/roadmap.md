# Roadmap

Forward-looking plans only — **not** a mirror of `src/`. **Doc index:** [README.md](./README.md). **Design / ship:** [architecture.md](./architecture.md), [packaging.md](./packaging.md). **Shipped features** (adapters, fixtures, `codemap agents init` — [agents.md](./agents.md)) live in `src/` and linked docs — not enumerated here.

---

## Next

- **Community language adapters** — optional packages (e.g. Tree-sitter) with a **peerDependency** on `@stainless-code/codemap` and a public **registration** API beyond built-ins in [`src/adapters/`](../src/adapters/).
- **Agent tooling** — evaluate [TanStack Intent](https://tanstack.com/intent/latest/docs/overview) for versioned skills in `node_modules` (optional; **`codemap agents init`** remains the default).
- **Golden queries** — design & policy: [golden-queries.md](./golden-queries.md); Tier A in CI, Tier B via `CODEMAP_*` (see [benchmark § Fixtures](./benchmark.md#fixtures)).

---

## Strategy

| Layer                  | Role                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Core**               | Schema, incremental indexing, git invalidation, `dependencies`, CLI, `query` |
| **Community adapters** | Future optional packages; **peerDependency** on `@stainless-code/codemap`    |

---

## Non-goals (v1)

Codemap stays a structural-index primitive that other tools can consume. Out of scope:

- **Full-text search** across all file bodies — use ripgrep / IDE / opt-in FTS5 (see backlog)
- **Replacing LSP** or language servers — no rename / go-to-definition / hover types
- **Static analysis** — dead code, duplication, complexity, architecture-boundary detection, fix actions are a different product class (e.g. [fallow](https://github.com/fallow-rs/fallow), `knip`, `jscpd`)
- **Visualization** — skyline / ASCII art / animated diagrams; the index emits structured rows, rendering belongs to the consumer
- **Embedded intent classification** beyond the thin keyword classifier in `codemap context --for "<intent>"` — deeper routing belongs in the agent host (Cursor / Claude Code / MCP client)
- **Persistent daemon process** — SQLite supports concurrent readers and our one-shot CLI startup is sub-100ms; revisit only if MCP / HTTP measurements demand it

---

## Backlog

- [ ] **`codemap audit --base <ref>`** — two-snapshot structural-drift verdict for a PR / branch (new files / deps / `@deprecated` / visibility / barrel / hot-file deltas; `pass`/`warn`/`fail` exit codes). Plan: [`plans/codemap-audit.md`](./plans/codemap-audit.md). Builds on B.6 (snapshot primitive), B.7 (`visibility`), Tier A flags (composition).
- [ ] **Agent transports — MCP server (v1) + HTTP API (v1.x)** — wrap codemap's structural-query surface (`query` / `audit` / `recipe` / `context` / `validate` / baseline ops) for agent-host integration. Plan: [`plans/agent-transports.md`](./plans/agent-transports.md). v1 ships `codemap mcp` (stdio + JSON-RPC, one tool per CLI verb, output shape verbatim from `--json`); v1.x adds `codemap serve [--port] [--host 127.0.0.1]` (loopback default; same tool taxonomy / output shape). Builds on every CLI primitive to date.
- [ ] **Recipes-as-content registry** — pair every bundled recipe in `src/cli/query-recipes.ts` with a sibling `.md` (or YAML frontmatter) describing _when to use, follow-up SQL_; surface in `--recipes-json`. Plus **project-local recipes** loaded from `.codemap/recipes/*.{sql,md}` so teams can ship internal SQL without an adapter API
- [ ] **Targeted-read CLI** — `codemap show <symbol>` / `codemap snippet <name>` returns `file_path:line_start-line_end` + `signature` for one symbol. Same data as `SELECT … FROM symbols WHERE name = ?`, but a one-step CLI keeps agents from composing SQL for trivial precise reads
- [ ] **Watch mode** for dev — `node:fs.watch` recursive + `--files` re-index loop; Linux `recursive` requires Node 19.1+
- [ ] **Monorepo / workspace awareness** — discover workspaces from `pnpm-workspace.yaml` / `package.json` and index per-workspace dependency graphs
- [ ] **Cross-agent handoff artifact** — _speculative_; layered prefix/delta JSON written on session-stop, read on session-start. Complementary to indexing rather than core to it; revisit if user demand emerges
- [ ] **Adapter scaffolding** — `codemap create-adapter --name [name]` generates adapter + test + fixture boilerplate; blocked on community adapter registration API (could land with manual registration)
- [ ] **Config loader** — two candidates: (a) [c12](https://unjs.io/packages/c12) — battle-tested (Nuxt/Nitro), adds extends, env overrides, RC files, watching; still executes config via `jiti`. (b) AST-based extraction with `oxc-parser` — faster, no side effects, safer in untrusted repos; can't handle async/dynamic configs, needs `import()` fallback. Current: native `import()` in `config.ts`
- [ ] Optional **GitHub Actions** `workflow_dispatch` — run golden/benchmark against a **public** corpus only (never private app code)
- [ ] Optional **FTS5** for opt-in full-text
- [ ] **Sass / Less / SCSS:** [Lightning CSS](https://lightningcss.dev/) is CSS-only; preprocessors need a compile step before CSS parsing — see [architecture.md § CSS](./architecture.md#css--css-parserts-lightningcss)
- [ ] **[UnJS](https://unjs.io) adoption** — candidates: [`citty`](https://unjs.io/packages/citty) (CLI builder), [`pathe`](https://unjs.io/packages/pathe) (cross-platform paths), [`consola`](https://unjs.io/packages/consola) (structured logging), [`pkg-types`](https://unjs.io/packages/pkg-types) (typed `package.json`/`tsconfig.json`), [`c12`](https://unjs.io/packages/c12) (config loader — see config loader item above)
