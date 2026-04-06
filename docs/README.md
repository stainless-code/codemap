# Codemap — documentation index

Technical docs for **[@stainless-code/codemap](https://github.com/stainless-code/codemap)**. Quick start: [../README.md](../README.md).

| File                                   | Topic                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)   | Schema, layering, CLI, programmatic API, parsers                                        |
| [bench-repo.md](./bench-repo.md)       | `CODEMAP_TEST_BENCH` / `.env` QA workflow                                               |
| [benchmark.md](./benchmark.md)         | Benchmark script; [`fixtures/minimal/`](../fixtures/minimal/)                           |
| [bun-reference.md](./bun-reference.md) | Upstream **`bun:sqlite`** doc links                                                     |
| [extraction.md](./extraction.md)       | Extraction history → layout in [architecture § Key Files](./architecture.md#key-files)  |
| [packaging.md](./packaging.md)         | `dist/`, npm entry, Node vs Bun, [Changesets](https://github.com/changesets/changesets) |
| [roadmap.md](./roadmap.md)             | Forward-looking backlog (not a `src/` inventory)                                        |
| [why-codemap.md](./why-codemap.md)     | Why index + SQL for agents                                                              |

**Conventions:** one topic per file; link with relative paths; no hardcoded symbol/file counts (use `codemap query` / `bun run dev query`); no source line numbers. **Contributors:** keep public API JSDoc useful; run `bun run check` — see [CONTRIBUTING](../.github/CONTRIBUTING.md).

**Also:** [.gitignore](../.gitignore) (`.codemap.db`), [.oxfmtrc.json](../.oxfmtrc.json) / [.oxlintrc.json](../.oxlintrc.json), [.agents/](../.agents/) / [.cursor/](../.cursor/) — [CONTRIBUTING](../.github/CONTRIBUTING.md).
