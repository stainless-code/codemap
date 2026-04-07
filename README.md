# Codemap

**Query your codebase.** Codemap builds a **local SQLite index** of structural metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers, and more) so **AI agents and tools** can answer “where / what / who” questions with **SQL** instead of scanning the whole tree.

- **Not** full-text search or grep on arbitrary strings — use those when you need raw file-body search.
- **Is** a fast, token-efficient way to navigate **structure**: definitions, imports, dependency direction, components, and other extracted facts.

**Documentation:** [docs/README.md](docs/README.md) is the hub (topic index + single-source rules). Topics: [architecture](docs/architecture.md), [agents](docs/agents.md) (`codemap agents init`), [benchmark](docs/benchmark.md), [golden queries](docs/golden-queries.md), [packaging](docs/packaging.md), [roadmap](docs/roadmap.md), [why Codemap](docs/why-codemap.md). **Bundled rules/skills:** [`.agents/rules/`](.agents/rules/), [`.agents/skills/codemap/SKILL.md`](.agents/skills/codemap/SKILL.md). **Consumers:** [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

---

## Install

```bash
bun add @stainless-code/codemap
# or: npm install @stainless-code/codemap
```

**Engines:** Node **`^20.19.0 || >=22.12.0`** and/or Bun **`>=1.0.0`** — see `package.json` and [docs/packaging.md](docs/packaging.md).

---

## CLI

- **Installed package:** `codemap`, `bunx @stainless-code/codemap`, or `node node_modules/@stainless-code/codemap/dist/index.mjs`
- **This repo (dev):** `bun src/index.ts` (same flags)

```bash
# Index project root (optional codemap.config.ts / codemap.config.json)
codemap

# Version (also: codemap --version, codemap -V)
codemap version

# Full rebuild
codemap --full

# SQL against the index (after at least one index run)
codemap query "SELECT name, file_path FROM symbols LIMIT 10"
# JSON array on stdout (agents / scripts); errors: {"error":"..."}
codemap query --json "SELECT name, file_path FROM symbols LIMIT 10"
# Query is not row-capped — add LIMIT in SQL for large selects
# Bundled SQL (same as skill examples): fan-out rankings
codemap query --recipe fan-out
codemap query --json --recipe fan-out-sample
# `components-by-hooks` ranks by hook count without SQLite JSON1 (comma-based count on the stored JSON array).

# Another project
codemap --root /path/to/repo --full

# Explicit config
codemap --config /path/to/codemap.config.json --full

# Re-index only given paths (relative to project root)
codemap --files src/a.ts src/b.tsx

# Scaffold .agents/ from bundled templates — full matrix: docs/agents.md
codemap agents init
codemap agents init --force
codemap agents init --interactive   # -i; IDE wiring + symlink vs copy
```

**Environment / flags:** `--root` overrides **`CODEMAP_ROOT`** / **`CODEMAP_TEST_BENCH`**, then **`process.cwd()`**. Indexing a project outside this clone: [docs/benchmark.md § Indexing another project](docs/benchmark.md#indexing-another-project).

**Configuration:** optional **`codemap.config.ts`** (default export object or async factory) or **`codemap.config.json`**. Shape: [codemap.config.example.json](codemap.config.example.json). Runtime validation (**Zod**, strict keys) and API surface: [docs/architecture.md § User config](docs/architecture.md#user-config). When developing inside this repo you can use `defineConfig` from `@stainless-code/codemap` or `./src/config`. If you set **`include`**, it **replaces** the default glob list entirely.

---

## Programmatic API (ESM)

```ts
import { createCodemap } from "@stainless-code/codemap";

const cm = await createCodemap({ root: "/path/to/repo" });
await cm.index({ mode: "incremental" });
await cm.index({ mode: "full" });
await cm.index({ mode: "files", files: ["src/a.ts"] });
await cm.index({ quiet: true });

const rows = cm.query("SELECT name FROM symbols LIMIT 5");
```

`createCodemap` configures a process-global runtime (`initCodemap`); only **one active project per process** is supported. Advanced: `runCodemapIndex` for an open DB handle. **Module layout:** [docs/architecture.md § Layering](docs/architecture.md#layering).

---

## Development

Tooling: **Oxfmt**, **Oxlint**, **tsgo** (`@typescript/native-preview`).

| Command                              | Purpose                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `bun run dev`                        | Run the CLI from source (same as `bun src/index.ts`)                       |
| `bun run check`                      | Build, format check, lint, tests, typecheck — run before pushing           |
| `bun run fix`                        | Apply lint fixes, then format                                              |
| `bun run test` / `bun run typecheck` | Focused checks                                                             |
| `bun run test:golden`                | SQL snapshot regression on `fixtures/minimal` (included in `check`)        |
| `bun run test:golden:external`       | Tier B: local tree via `CODEMAP_*` / `--root` (not in default `check`)     |
| `bun run qa:external`                | Index + sanity checks + benchmark on `CODEMAP_ROOT` / `CODEMAP_TEST_BENCH` |

```bash
bun install
bun run check    # build + format:check + lint + test + typecheck
bun run fix      # oxlint --fix, then oxfmt
```

**Readability & DX:** Prefer clear names and small functions; keep **JSDoc** on public exports. [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) has contributor workflow and conventions.

---

## Benchmark

Use a **real** project path (the repo must exist on disk). See [docs/benchmark.md § Indexing another project](docs/benchmark.md#indexing-another-project).

```bash
CODEMAP_ROOT=/absolute/path/to/indexed-repo bun src/benchmark.ts
```

Optional **`CODEMAP_BENCHMARK_CONFIG`** for repo-specific scenarios: [docs/benchmark.md § Custom scenarios](docs/benchmark.md#custom-scenarios-codemap_benchmark_config).

---

## Organization

Developed under **[stainless-code](https://github.com/stainless-code)** on GitHub.

## License

MIT — see [LICENSE](LICENSE).
