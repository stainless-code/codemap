# Codemap — documentation index

Technical docs for **[@stainless-code/codemap](https://github.com/stainless-code/codemap)**. Quick start: [../README.md](../README.md).

| File                                 | Topic                                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md) | Schema, layering, CLI, API, [**User config**](./architecture.md#user-config) (Zod), parsers, [Key Files](./architecture.md#key-files)                                               |
| [agents.md](./agents.md)             | **`codemap agents init`**, **`--interactive`**, **`.gitignore` / `.codemap.*`**, IDE wiring (Cursor, Copilot, Windsurf, …), **`templates/agents`**                                  |
| [benchmark.md](./benchmark.md)       | [**Indexing another project**](./benchmark.md#indexing-another-project) · [**Benchmark script**](./benchmark.md#the-benchmark-script) · [`fixtures/minimal/`](../fixtures/minimal/) |
| [packaging.md](./packaging.md)       | **`CHANGELOG.md` / `dist/` / `templates/`** on npm, **engines**, [**Node vs Bun**](./packaging.md#node-vs-bun), [**Releases**](./packaging.md#releases) (Changesets)                |
| [roadmap.md](./roadmap.md)           | Forward-looking backlog (not a `src/` inventory)                                                                                                                                    |
| [why-codemap.md](./why-codemap.md)   | Why index + SQL for agents (speed, tokens, accuracy)                                                                                                                                |

**Cross-cutting:** Runtime splits (SQLite, workers, globs, JSON config I/O) — [packaging § Node vs Bun](./packaging.md#node-vs-bun) only (link it; don’t copy the table). **User config** shape/validation — [architecture § User config](./architecture.md#user-config) only. **Agent templates / `agents init`** — [agents.md](./agents.md) only (don’t duplicate the IDE table elsewhere).

**Conventions:** One topic per file; relative links; avoid stale file/symbol counts in narrative docs (use `codemap query` / `bun run dev query` after indexing; methodology tables in [benchmark.md](./benchmark.md) are fine). **This repo:** `bun run dev` → `bun src/index.ts`; `bun run build` → tsdown → `dist/`; `bun run clean` / `bun run check-updates` — [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md). **Contributors:** branch + PR into **`main`** ([CI](../.github/workflows/ci.yml)), `bun run check`, JSDoc on public API.
