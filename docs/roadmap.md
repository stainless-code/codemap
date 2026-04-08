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

- Full-text search across all file bodies (use ripgrep / IDE)
- Replacing LSP or language servers

---

## Backlog

- [ ] **`--performance` CLI flag** — per-phase timing breakdown (glob, parse, resolve, insert, indexes) via `performance.now()`; `index-engine.ts` already has total elapsed, gap is per-phase granularity
- [ ] **Adapter scaffolding** — `codemap create-adapter --name [name]` generates adapter + test + fixture boilerplate; blocked on community adapter registration API (could land with manual registration)
- [ ] **Config loader** — two candidates: (a) [c12](https://unjs.io/packages/c12) — battle-tested (Nuxt/Nitro), adds extends, env overrides, RC files, watching; still executes config via `jiti`. (b) AST-based extraction with `oxc-parser` — faster, no side effects, safer in untrusted repos; can't handle async/dynamic configs, needs `import()` fallback. Current: native `import()` in `config.ts`
- [ ] **MCP** server wrapping `query`
- [ ] **Watch mode** for dev — `node:fs.watch` recursive + `--files` re-index loop; Linux `recursive` requires Node 19.1+
- [ ] **Monorepo / workspace awareness** — discover workspaces from `pnpm-workspace.yaml` / `package.json` and index per-workspace dependency graphs
- [ ] Optional **GitHub Actions** `workflow_dispatch` — run golden/benchmark against a **public** corpus only (never private app code)
- [ ] Optional **FTS5** for opt-in full-text
- [ ] **Sass / Less / SCSS:** [Lightning CSS](https://lightningcss.dev/) is CSS-only; preprocessors need a compile step before CSS parsing — see [architecture.md § CSS](./architecture.md#css--css-parserts-lightningcss)
- [ ] **[UnJS](https://unjs.io) adoption** — candidates: [`citty`](https://unjs.io/packages/citty) (CLI builder), [`pathe`](https://unjs.io/packages/pathe) (cross-platform paths), [`consola`](https://unjs.io/packages/consola) (structured logging), [`pkg-types`](https://unjs.io/packages/pkg-types) (typed `package.json`/`tsconfig.json`), [`c12`](https://unjs.io/packages/c12) (config loader — see config loader item above)
