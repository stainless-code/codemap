# Roadmap

Forward-looking plans only — **not** a mirror of `src/`. **Where things live:** `package.json`, `src/`, `.github/workflows/`; **design:** [README.md](./README.md) (index), [architecture.md](./architecture.md), [packaging.md](./packaging.md).

---

## Next

### Pluggable language adapters

**TypeScript/JavaScript**, **CSS**, and **text/markers** are implemented under **`src/`** (oxc, lightningcss, etc.). **Not** done: a stable **`LanguageAdapter`-style** boundary so more languages ship as add-ons:

```text
LanguageAdapter
  id: string
  extensions: string[]
  parseFile(path, content, ctx): ParsedFileFragment
```

- [ ] Define and document the internal adapter boundary (even if only one implementation ships in-repo at first).
- [ ] Optional community packages (e.g. Tree-sitter-based) with a **peerDependency** on `@stainless-code/codemap`.

### Benchmarks & fixtures

- [ ] **Fixture tree(s)** under `fixtures/` — [benchmark.md § Fixtures (planned)](./benchmark.md#fixtures-planned)
- [ ] Point **`CODEMAP_ROOT`** / **`--root`** at a fixture in CI for **repeatable** benchmark numbers

### Agent tooling

- [ ] **`codemap`** subcommands or a small companion CLI to **generate/sync** agent files (Cursor rules, `AGENTS.md`, `.agents/skills/` stubs) — org layout TBD
- [ ] Evaluate **[TanStack Intent](https://tanstack.com/intent/latest/docs/overview)** for versioned skills in `node_modules` (optional; generator remains fallback)

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
