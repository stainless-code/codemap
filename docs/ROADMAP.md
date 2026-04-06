# Roadmap

**Package:** `@stainless-code/codemap`  
**Tagline:** *Query your codebase* — structural index for AI agents (SQLite + SQL), not full-text grep.

## Repository

- **GitHub:** [github.com/stainless-code/codemap](https://github.com/stainless-code/codemap)

## Extraction phases

Each phase should end with a **tagged release** and **working CLI + tests**.

### Phase A — Bootstrap (in progress)

- [x] MIT `LICENSE`, `README.md`, `package.json`, `.gitignore`
- [ ] CI: lint, typecheck, tests on `ubuntu` (macOS optional)
- [ ] Import implementation (verbatim port first, then generalize): SQLite schema, parsers, CLI, benchmarks

### Phase B — Config

- [ ] Replace single hardcoded project root with **`root`** from config (default `process.cwd()`)
- [ ] **`codemap.config.ts`** (or JSON + schema): include/exclude globs, database path, `tsconfig` for import resolution

### Phase C — Public API

- [ ] Exports: `buildIndex({ mode })`, `openDatabase()`, `query(sql)`
- [ ] CLI: `codemap`, `codemap query`, `codemap --full`, `codemap --files`

### Phase D — Language adapters

Stable internal interface so new languages do not fork core:

```text
LanguageAdapter
  id: string
  extensions: string[]
  parseFile(path, content, ctx): ParsedFileFragment
```

- [ ] **Built-in:** TypeScript/JavaScript (oxc), CSS (lightningcss), text/markers
- [ ] **Optional packages:** e.g. `@stainless-code/codemap-adapter-rust` (Tree-sitter, peers on core)

### Phase E — Consumers

- [ ] Downstream apps use `bunx @stainless-code/codemap` or a workspace dependency
- [ ] Agent-facing docs: when to **query Codemap** vs **grep / read files**

## Multi-language strategy

| Layer | Role |
| ----- | ---- |
| **Core** | Schema, incremental indexing, git invalidation, `dependencies`, CLI, `query` |
| **Built-in adapters** | Shipped in `@stainless-code/codemap` |
| **Community adapters** | Separate packages; **peerDependency** on `codemap` semver range |

## Non-goals (v1)

- Full-text search across all file bodies (use ripgrep / IDE)
- Replacing LSP or language servers
- Guaranteed Node.js runtime (v1 may stay Bun-only)

## Backlog

- [ ] Optional FTS5 for opt-in full-text
- [ ] MCP server wrapping `query`
- [ ] Watch mode for dev
- [ ] Pluggable route extractors (e.g. Next.js, Remix) alongside TanStack-style routes
