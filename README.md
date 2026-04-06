# Codemap

**Query your codebase.** Codemap builds a **local SQLite index** of structural metadata (symbols, imports, exports, dependencies, routes, CSS tokens, markers, and more) so **AI agents and tools** can answer “where / what / who” questions with **SQL** instead of scanning the whole tree.

- **Not** a replacement for full-text search or grep on arbitrary strings — use those when you need file-body search.
- **Is** a fast, token-efficient way to navigate **structure**: definitions, imports, dependency direction, route tables, etc.

## Status

Early stage: **implementation is being extracted** into this repository. See [docs/ROADMAP.md](docs/ROADMAP.md) for phases, adapter plans, and how to contribute.

**Runtime (planned v1):** [Bun](https://bun.sh) (`bun:sqlite`, workers). Broader runtime support may follow.

## Package

```bash
bun add @stainless-code/codemap
```

(`0.0.0` placeholder until the first published release.)

## Organization

Developed under **[stainless-code](https://github.com/stainless-code)** on GitHub.

## License

MIT — see [LICENSE](LICENSE).
