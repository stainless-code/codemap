# Codemap — documentation index

Technical docs for **[@stainless-code/codemap](https://github.com/stainless-code/codemap)**. Quick start: [../README.md](../README.md).

| File                                 | Topic                                                                                                                                                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [architecture.md](./architecture.md) | Schema, layering, CLI, programmatic API, [**User config**](./architecture.md#user-config) (Zod), parsers, [Key Files](./architecture.md#key-files)                                                                             |
| [benchmark.md](./benchmark.md)       | **[Indexing another project](./benchmark.md#indexing-another-project)** (`CODEMAP_*`, `.env`) · **[benchmark script](./benchmark.md#the-benchmark-script)** (`src/benchmark.ts`) · [`fixtures/minimal/`](../fixtures/minimal/) |
| [packaging.md](./packaging.md)       | `dist/`, npm **`files`**, **engines**, **[Node vs Bun](./packaging.md#node-vs-bun)**, **[Releases](./packaging.md#releases)** (Changesets)                                                                                     |
| [roadmap.md](./roadmap.md)           | Forward-looking backlog (not a `src/` inventory)                                                                                                                                                                               |
| [why-codemap.md](./why-codemap.md)   | Why index + SQL for agents (speed, tokens, accuracy)                                                                                                                                                                           |

**Cross-cutting:** SQLite, workers, include globs, and **JSON config I/O** use Bun when available — **[packaging.md § Node vs Bun](./packaging.md#node-vs-bun)** (single table; don’t duplicate elsewhere). **Config shape / validation** (Zod, strict keys) lives only in **[architecture.md § User config](./architecture.md#user-config)**.

**Conventions:** one topic per file; relative links; no symbol/file counts or source line numbers (use `codemap query` / `bun run dev query` after indexing). **This repo:** `bun run dev` → `bun src/index.ts`; **`bun run build`** → tsdown → `dist/`. **Contributors:** `bun run check`, JSDoc on public API — [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md).
