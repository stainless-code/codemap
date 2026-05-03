# Competitive scan — fallow, AZidan/codemap, JordanCoin/codemap

> Inspiration scan from three sibling tools in the "AI-friendly code intelligence" space.
> Captured **2026-04-27** during PR [#23](https://github.com/stainless-code/codemap/pull/23). Most adopt items shipped in that PR; remaining items moved to [docs/roadmap.md](../roadmap.md).
>
> **Fallow updates (post-scan):** fallow ships rapidly. Ongoing capability tracking — what fallow has shipped since this snapshot, what remains adoption-worthy, and where it explicitly should _not_ be copied — lives in [`research/fallow.md`](./fallow.md). AZidan and JordanCoin haven't moved meaningfully; they stay in this dated snapshot.

Sources:

- [fallow-rs/fallow](https://github.com/fallow-rs/fallow) — Rust, ~1.1k stars, TS/JS-only, "codebase intelligence" (dead code, dupes, complexity, boundaries, runtime). 91 framework plugins.
- [AZidan/codemap](https://github.com/AZidan/codemap) — Python, ~55 stars, "make LLM reads cheaper" (symbol→line-range index). Multi-language tree-sitter.
- [JordanCoin/codemap](https://github.com/JordanCoin/codemap) — Go, ~525 stars, "project brain" (tree+diff+deps+skyline+handoff). Hooks/MCP/HTTP/skills.

---

## 1. Positioning recap (snapshot at scan time)

**Codemap is:** a **structural SQLite index** → agents call **SQL** for symbols, imports, exports, components, calls, type members, deps, CSS tokens/classes/keyframes, markers. AST-backed (oxc, lightningcss, oxc-resolver). Bun + Node, TS/CSS-first. CLI **`codemap query --json`** + **`codemap agents init`** for IDE wiring.

**Codemap is not:** a dead-code detector, duplication finder, dependency-flow visualizer, semantic understanding layer, or agent runtime. The canonical "what Codemap is not" list now lives in [why-codemap.md § What Codemap is not](../why-codemap.md#what-codemap-is-not) and the explicit non-goals are in [roadmap.md § Non-goals](../roadmap.md#non-goals-v1) — keep this doc free of duplicates.

---

## 2. Side-by-side (snapshot)

| Axis              | **us**                                  | fallow                                                 | AZidan/codemap                       | JordanCoin/codemap                           |
| ----------------- | --------------------------------------- | ------------------------------------------------------ | ------------------------------------ | -------------------------------------------- |
| Lang of impl      | TS (Bun/Node)                           | Rust                                                   | Python                               | Go                                           |
| Storage           | SQLite (`.codemap/index.db`)            | in-process; SARIF/JSON outputs                         | distributed JSON (`.codemap/*.json`) | per-project `.codemap/` JSON artifacts       |
| Query surface     | **SQL** (full power)                    | CLI subcommands, `--format json`                       | `find`/`show`/`stats` CLI            | `tree`/`--diff`/`--deps`/`context`/MCP/HTTP  |
| What's indexed    | symbols, imports/exports, deps, CSS, …  | module graph, dupe clones, complexity, boundary rules  | symbols + line ranges + hash         | tree + dep flow + hubs + working set         |
| Agent integration | rules/skills via `agents init`          | MCP, LSP, VSCode ext, `--format json` w/ fix `actions` | Claude plugin, MCP planned           | hooks, MCP, HTTP, "context envelope", skills |
| Refresh model     | git-diff incremental + targeted `files` | full+changed-since                                     | hash + watch + git pre-commit        | daemon, hooks, watch                         |
| TS/JS depth       | oxc AST                                 | oxc AST + boundary/dup/complexity                      | tree-sitter                          | ast-grep (deps only)                         |
| Other langs       | CSS                                     | TS/JS only (intentional)                               | 14 langs (tree-sitter)               | 18 langs (deps via ast-grep)                 |
| Headline pitch    | "query your codebase"                   | "codebase truth layer for agents"                      | "make every read cheaper"            | "project brain for your AI"                  |
| License           | MIT                                     | MIT (+ paid runtime)                                   | MIT                                  | MIT                                          |

> A consumer-facing distillation of this table — focused on philosophy/scope rather than implementation — lives in [why-codemap.md § Codemap vs alternatives](../why-codemap.md#codemap-vs-alternatives). Keep prose comparisons there; this row is the unfiltered scan record.

---

## 3. What shipped from this scan

| Idea (originally §3 / §4 / §5 of this scan)                                             | Shipped where                                                                           | Inspired by                                           |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `codemap context` JSON envelope (incl. `--for "<intent>"` thin classifier, `--compact`) | `src/cli/cmd-context.ts` + `src/application/context-engine.ts`                          | JordanCoin (`codemap context`)                        |
| `codemap validate` (hash-based staleness, no re-read)                                   | `src/cli/cmd-validate.ts` + `src/application/validate-engine.ts`                        | AZidan (`codemap validate`)                           |
| `--performance` per-phase timing + top-10 slowest files                                 | `src/application/index-engine.ts`                                                       | own roadmap, sharpened by JordanCoin's daemon framing |
| `deprecated-symbols` recipe                                                             | `src/application/query-recipes.ts`                                                      | fallow JSDoc visibility tags                          |
| `visibility-tags` recipe (`@internal` / `@private` / `@alpha` / `@beta`)                | `src/application/query-recipes.ts`                                                      | fallow JSDoc visibility tags                          |
| `barrel-files` recipe (top files by export count)                                       | `src/application/query-recipes.ts`                                                      | own derivation from JordanCoin "hubs" framing         |
| `files-hashes` recipe powering `validate`                                               | `src/application/query-recipes.ts`                                                      | AZidan                                                |
| `-r` short alias for `--recipe`, cleaner `--help`                                       | `src/cli/cmd-query.ts`                                                                  | own UX polish                                         |
| Friendlier "no `.codemap/index.db`" error                                               | `src/application/index-engine.ts`                                                       | own UX polish                                         |
| Anti-pitch — "What Codemap is not"                                                      | [why-codemap.md § What Codemap is not](../why-codemap.md#what-codemap-is-not)           | AZidan                                                |
| Scenario-keyed token-savings table                                                      | [why-codemap.md § Across a Typical Session](../why-codemap.md#across-a-typical-session) | AZidan                                                |
| "Grep/Read vs Codemap" capability table                                                 | [README.md § What you get](../../README.md#what-you-get)                                | fallow ("Linter vs Fallow")                           |
| "Daily commands" stripe + version-matched skill framing                                 | [README.md § CLI](../../README.md#cli)                                                  | JordanCoin / fallow packaging                         |
| Alternatives comparison table                                                           | [why-codemap.md § Codemap vs alternatives](../why-codemap.md#codemap-vs-alternatives)   | AZidan ("CodeMap vs RepoMap/Serena/RepoPrompt")       |
| Schema v3 — `NOT NULL` audit (orthogonal to scan but landed in same PR)                 | `src/db.ts`                                                                             | CodeRabbit review during PR #23                       |

All shipped under PR [#23](https://github.com/stainless-code/codemap/pull/23) as schema-bump-driven minor release.

---

## 4. What moved to the roadmap

Items the scan called out as "watch / defer / future" — most still live in [docs/roadmap.md § Backlog](../roadmap.md#backlog); items shipped after this scan are linked to their PRs.

- ✅ **MCP server wrapping `query`** — shipped as `codemap mcp` (agent-transports v1) in PR [#35](https://github.com/stainless-code/codemap/pull/35). Tool taxonomy, output shape, and resource catalog reserved for HTTP API to inherit.
- ✅ **Recipes-as-content registry + project-local recipes (`.codemap/recipes/`)** — shipped in PR [#37](https://github.com/stainless-code/codemap/pull/37). Catalog gains `source` / `body` / `shadows` fields so agents see project overrides at session start.
- ✅ **Targeted-read CLI (`codemap show <symbol>`)** — shipped as `show` + `snippet` siblings in PR [#39](https://github.com/stainless-code/codemap/pull/39).
- ✅ **`--format sarif` + `--format annotations`** — shipped in PR [#43](https://github.com/stainless-code/codemap/pull/43). GitHub Code Scanning + PR-inline annotations for any recipe row-set.
- ✅ **HTTP API (`codemap serve`)** — shipped in PR [#44](https://github.com/stainless-code/codemap/pull/44). Same tool taxonomy as MCP, `POST /tool/{name}`, loopback default, optional `--token`.
- ✅ **Watch mode (`codemap watch`)** — shipped in PR [#47](https://github.com/stainless-code/codemap/pull/47), planned in PR [#46](https://github.com/stainless-code/codemap/pull/46). Standalone + `mcp --watch` / `serve --watch` killer combos; chokidar v5 backend.
- See [`research/fallow.md` § Status snapshot](./fallow.md#status-snapshot-as-of-2026-05-03) for the full ship summary.
- Cross-agent handoff artifact (speculative) — still backlog

The scan's "PASS" list (dead-code / dupes / complexity / boundaries / fix actions, runtime/V8 coverage merging, framework plugins, PageRank summarization, skyline visualization, daemon process, embedded intent classification) has been folded into [roadmap.md § Non-goals](../roadmap.md#non-goals-v1) — that's the canonical home; do not duplicate here.

**Explicitly dropped:** "remote-repo support" (`codemap github.com/x/y`) — discussed in [PR #23](https://github.com/stainless-code/codemap/pull/23) and rejected as demoware that doesn't fit the SQL-index thesis.

---

## 5. Open questions (still open)

These were not resolved in PR #23 and warrant their own design conversations:

- ✅ **Should recipes own their description?** — Settled in PR [#37](https://github.com/stainless-code/codemap/pull/37): file-pair `<id>.{sql,md}` in `templates/recipes/` (bundled) and `<projectRoot>/.codemap/recipes/` (project-local), loaded at runtime via `node:fs/readdirSync`. YAML frontmatter on `.md` carries the per-row `actions` template.
- **Daemon vs one-shot** — JordanCoin's daemon is the only way they get sub-100ms hooks. Our CLI startup is ~50–100 ms cold (Node) and lower on Bun; we may not need a daemon at all. Worth measuring once MCP/HTTP land. Roadmap lists "persistent daemon" as a non-goal **for now** with this caveat.

---

## 6. Citations / cross-links

- [docs/roadmap.md](../roadmap.md) — current backlog and non-goals
- [docs/why-codemap.md](../why-codemap.md) — anti-pitch, token-cost framing, alternatives comparison
- [docs/architecture.md](../architecture.md) — schema and CLI layering
- [PR #23](https://github.com/stainless-code/codemap/pull/23) — the implementation pass driven by this scan
