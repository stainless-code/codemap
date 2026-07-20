# Codemap

**Query your codebase.** Local codebase intelligence for AI agents — a SQLite index of symbols, imports, calls, and more structural metadata so agents answer “where / what / who” with **SQL** and recipes instead of scanning the tree.

- **Not** grep by default — use ripgrep / your IDE for raw text. Opt-in FTS5 (`--with-fts` / `fts5: true`) when body matches need to JOIN with structure.
- **Is** a fast, token-efficient way to navigate **structure**.

**Docs:** [https://stainless-code.com/codemap](https://stainless-code.com/codemap)

---

## What you get

Structural questions in **one SQL round-trip** instead of 3–5 file reads — symbol definitions, import direction, components, CSS tokens, `@deprecated` symbols, and more. Named patterns ship as recipes (`codemap query --recipe …`); full catalog and schema live in the docs.

---

## Install

```bash
bun add @stainless-code/codemap
# or: npm install @stainless-code/codemap
```

**Engines:** Node **`^20.19.0 || >=22.12.0`** and/or Bun **`>=1.0.31`**.

---

## CLI

```bash
codemap                                                      # incremental index
codemap query --json --recipe find-symbol-definitions --params name=foo
codemap query --json "SELECT name, file_path FROM symbols WHERE name = 'foo'"
codemap show foo
codemap agents init --mcp                                    # agent templates + MCP
```

Full command reference, recipes, MCP/HTTP, config, and the GitHub Action: **[docs site](https://stainless-code.com/codemap)**.

---

## Programmatic API (ESM)

```ts
import { createCodemap } from "@stainless-code/codemap";

const cm = await createCodemap({ root: "/path/to/repo" });
await cm.index({ mode: "incremental" });
const rows = cm.query("SELECT name FROM symbols LIMIT 5");
```

API reference: [https://stainless-code.com/codemap/reference/api](https://stainless-code.com/codemap/reference/api).

---

## Development

Contributor workflow, checks, and conventions: [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md).

```bash
bun install
bun run check
```

Maintainer hub: [docs/README.md](docs/README.md).

---

## License

MIT — see [LICENSE](LICENSE).
