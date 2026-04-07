# Roadmap

Forward-looking plans only — **not** a mirror of `src/`. **Hub:** [README.md](./README.md). **Design:** [architecture.md](./architecture.md), [packaging.md](./packaging.md). **Shipped features** (adapters, fixtures, `codemap agents init` — [agents.md](./agents.md)) live in `src/` and linked docs — not enumerated here.

---

## Next

- **Community language adapters** — optional packages (e.g. Tree-sitter) with a **peerDependency** on `@stainless-code/codemap` and a public **registration** API beyond built-ins in [`src/adapters/`](../src/adapters/).
- **Agent tooling** — evaluate [TanStack Intent](https://tanstack.com/intent/latest/docs/overview) for versioned skills in `node_modules` (optional; **`codemap agents init`** remains the default).

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

- [ ] Optional **FTS5** for opt-in full-text
- [ ] **MCP** server wrapping `query`
- [ ] **Watch mode** for dev
- [ ] **Sass / Less / SCSS:** [Lightning CSS](https://lightningcss.dev/) is CSS-only; preprocessors need a compile step before CSS parsing — see [architecture.md § CSS](./architecture.md#css--css-parserts-lightningcss)
