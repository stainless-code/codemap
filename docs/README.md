# Codemap — documentation index

Technical docs for **[@stainless-code/codemap](https://github.com/stainless-code/codemap)**.

**Start here:** [../README.md](../README.md) (install, CLI, API, dev commands). **This folder** is deeper reference — pick a row below.

## File Ownership

Each topic has exactly one canonical file. Other files cross-reference by relative path, never duplicate.

| File                                          | Topic                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [why-codemap.md](./why-codemap.md)            | Why index + SQL for agents (speed, tokens, accuracy). Anti-pitch ([What Codemap is not](./why-codemap.md#what-codemap-is-not)) and [alternatives comparison](./why-codemap.md#codemap-vs-alternatives). Good first read after the readme.                                                                                                                                                           |
| [architecture.md](./architecture.md)          | Schema, layering, CLI internals, API, [**User config**](./architecture.md#user-config) (Zod), parsers, [Key Files](./architecture.md#key-files).                                                                                                                                                                                                                                                    |
| [glossary.md](./glossary.md)                  | Canonical term definitions. Disambiguates pairs like `FileRow` vs `files` table, recipe vs query, schema vs DDL, hub vs barrel.                                                                                                                                                                                                                                                                     |
| [agents.md](./agents.md)                      | **`codemap agents init`** — bundled **`templates/agents`** → **`.agents/`** in **consumer projects** (this repo's **`.agents/`** is dev/maintainer); per-file IDE symlink/copy, **[pointer files](./agents.md#pointer-files)** (`codemap-pointer`), **`--interactive`**, **`.gitignore` / `.codemap.*`**.                                                                                           |
| [benchmark.md](./benchmark.md)                | [**Indexing another project**](./benchmark.md#indexing-another-project) · [**Benchmark script**](./benchmark.md#the-benchmark-script) · [**Query stdout (table vs JSON)**](./benchmark.md#query-stdout-table-vs-json-benchmarkquery) · [**Custom scenarios**](./benchmark.md#custom-scenarios-codemap_benchmark_config) (`CODEMAP_BENCHMARK_CONFIG`) · [`fixtures/minimal/`](../fixtures/minimal/). |
| [golden-queries.md](./golden-queries.md)      | Golden `query` **design & policy** (Tier A/B, no proprietary trees); runner: [scripts/query-golden.ts](../scripts/query-golden.ts).                                                                                                                                                                                                                                                                 |
| [fixtures/golden/](../fixtures/golden/)       | [scenarios.json](../fixtures/golden/scenarios.json) + [minimal/](../fixtures/golden/minimal/) — **`bun run test:golden`**; Tier B: [scenarios.external.example.json](../fixtures/golden/scenarios.external.example.json) + **`bun run test:golden:external`** ([benchmark § Fixtures](./benchmark.md#fixtures)).                                                                                    |
| [fixtures/benchmark/](../fixtures/benchmark/) | Tracked [scenarios.example.json](../fixtures/benchmark/scenarios.example.json) — copy to `*.local.json` (gitignored) for [`CODEMAP_BENCHMARK_CONFIG`](./benchmark.md#custom-scenarios-codemap_benchmark_config).                                                                                                                                                                                    |
| [fixtures/qa/](../fixtures/qa/)               | [prompts.external.template.md](../fixtures/qa/prompts.external.template.md) — optional chat QA prompts for an external index (`*.local.md` gitignored).                                                                                                                                                                                                                                             |
| [packaging.md](./packaging.md)                | **`CHANGELOG.md` / `dist/` / `templates/`** on npm, **engines**, [**Node vs Bun**](./packaging.md#node-vs-bun), [**Releases**](./packaging.md#releases) (Changesets; **`bun run version`** + oxfmt **`CHANGELOG.md`**).                                                                                                                                                                             |
| [roadmap.md](./roadmap.md)                    | Forward-looking [**Backlog**](./roadmap.md#backlog) and [**Non-goals**](./roadmap.md#non-goals-v1) (not a `src/` inventory).                                                                                                                                                                                                                                                                        |
| [plans/](./plans/)                            | One `<feature-name>.md` per in-flight plan. Created on demand — don't add the `-plan` suffix; the folder provides context. Currently in flight: [`fts5-mermaid.md`](./plans/fts5-mermaid.md), [`c9-plugin-layer.md`](./plans/c9-plugin-layer.md).                                                                                                                                                   |
| [research/](./research/)                      | Dated, snapshot-style notes (e.g. competitive scans). Each note links shipped items back to canonical homes — see [research/competitive-scan-2026-04.md](./research/competitive-scan-2026-04.md).                                                                                                                                                                                                   |

---

## Rules for Agents

These rules are normative — cite them by number in PR review. Ordered by how often they fire, not severity.

1. **One source of truth** — every topic lives in exactly one file. Other files cross-reference by relative path; never duplicate prose. See the [Single source of truth](#single-source-of-truth-do-not-duplicate) table for cross-cutting topics.
2. **When a backlog item ships** — move the description from [roadmap.md](./roadmap.md) to its canonical home ([architecture.md](./architecture.md), [why-codemap.md](./why-codemap.md), or root [README.md](../README.md)). Remove the item from `roadmap.md` entirely; the roadmap is forward-looking.
3. **When adding a feature plan** — create `plans/<feature-name>.md`. Don't embed plans in `roadmap.md`; link from there.
4. **Keep ownership tables current** — when creating or deleting a doc file, update the [File Ownership](#file-ownership) and [Single source of truth](#single-source-of-truth-do-not-duplicate) tables in the same PR. A stale table is worse than no table.
5. **Cross-references use relative paths** — `[architecture.md § Section](./architecture.md#section)` or `[plans/foo.md](./plans/foo.md)`. Prefer section-deep links over file-only links.
6. **No inventory counts in narrative** — don't hardcode counts of files, symbols, recipes, or other code-derived quantities. Use qualitative descriptors or a `codemap query --json` example. Decision values (cache TTLs, batch sizes, schema version) are fine — those are decisions, not inventory.
7. **No line-number references** — line numbers (e.g. `parser.ts:241`) rot on every edit. Reference by function name, section heading, or symbol from `codemap query` instead. Methodology tables in [benchmark.md](./benchmark.md) are exempt.
8. **Research notes get closed** — when a research scan's adopt items ship, slim the note to a "What shipped" appendix linking to canonical homes (see [research/competitive-scan-2026-04.md](./research/competitive-scan-2026-04.md) as the precedent). Rejected items keep a `Status: Rejected (date) — <one-line reason>` header.
9. **New term ⇒ update [glossary.md](./glossary.md) in the same PR** — when a PR introduces a new domain noun / verb / acronym (table name, recipe id, parser name, schema column), add or update its entry. Disambiguations (e.g. `FileRow` TS shape vs `files` SQLite table) take priority over single defs.
10. **Core surface change ⇒ update bundled agent rule + skill in the same PR** — when a PR adds / changes a CLI flag, recipe id, recipe `actions` template, schema column, or any other surface an agent would query, update **both** copies of the codemap rule + skill so installed agents and this clone stay in lockstep:
    - **`templates/agents/rules/codemap.md`** + **`templates/agents/skills/codemap/SKILL.md`** (ships to npm via `codemap agents init`).
    - **`.agents/rules/codemap.md`** + **`.agents/skills/codemap/SKILL.md`** (this clone's dev-side mirror — keeps my own session view of the CLI accurate).
      Drift between the two pairs should be **CLI-prefix-only** (`codemap` vs `bun src/index.ts`) — anything else means content has diverged. Schema-version bumps and new recipes are the most common trigger; output flags (e.g. `--summary`, `--changed-since`, `--group-by`) come second. Patch changeset suffices when the underlying feature already shipped its own changeset (templates/agents/ is the only ship-affecting surface in such a PR).

---

## Single source of truth (do not duplicate)

Cross-cutting topics that span multiple files. Each has exactly one canonical home; other files link, never copy.

| Topic                                                                                                                                                                                                                                                                                                                   | Canonical doc                                                                            | Elsewhere                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime splits (SQLite, workers, globs, JSON config I/O)                                                                                                                                                                                                                                                                | [packaging § Node vs Bun](./packaging.md#node-vs-bun) — **the table lives here**         | [architecture § Runtime](./architecture.md#runtime-and-database) links here; do not copy the table                                                                           |
| **`<state-dir>/config.{ts,js,json}`** shape / Zod validation                                                                                                                                                                                                                                                            | [architecture § User config](./architecture.md#user-config)                              | Root [README § Configuration](../README.md#configuration) points here                                                                                                        |
| **`codemap agents init`**: **`--force`** on **`.agents/`** in **consumer projects** (template file paths only), IDE matrix, per-file symlink/copy, **`templates/agents`**                                                                                                                                               | [agents.md](./agents.md)                                                                 | Link here; do not paste the integration table into README or packaging                                                                                                       |
| **`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / Copilot** — managed **`codemap-pointer`** sections, merge vs **`--force`**                                                                                                                                                                                                  | [agents.md § Pointer files](./agents.md#pointer-files)                                   | Link here; do not duplicate the situation table                                                                                                                              |
| End-user CLI (index, **`query --json`**, **`query --recipe`**, **`query --recipes-json`**, **`query --print-sql`**, agents, flags, env) — query has no row cap; use SQL **`LIMIT`**; **`--json`** errors include SQL, DB open, and bootstrap failures; bundled **`templates/agents/`** examples default to **`--json`** | [../README.md § CLI](../README.md#cli)                                                   | [architecture § CLI usage](./architecture.md#cli-usage) summarizes and links back; [agents.md](./agents.md)                                                                  |
| Golden query regression (`test:golden`, `test:golden:external`, `--update`)                                                                                                                                                                                                                                             | [golden-queries.md](./golden-queries.md)                                                 | CONTRIBUTING § Golden queries; [benchmark § Fixtures](./benchmark.md#fixtures)                                                                                               |
| **`CODEMAP_BENCHMARK_CONFIG`** (per-repo benchmark JSON)                                                                                                                                                                                                                                                                | [benchmark § Custom scenarios](./benchmark.md#custom-scenarios-codemap_benchmark_config) | [fixtures/benchmark/scenarios.example.json](../fixtures/benchmark/scenarios.example.json) only                                                                               |
| `bun run qa:external` — index + disk checks + `benchmark.ts` on **`CODEMAP_*`**                                                                                                                                                                                                                                         | [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)                                    | [scripts/qa-external-repo.ts](../scripts/qa-external-repo.ts) (invocation only)                                                                                              |
| **Non-goals (v1)** — what Codemap deliberately doesn't do (full-text search, LSP, static analysis, visualization, daemon, deep intent classification)                                                                                                                                                                   | [roadmap.md § Non-goals](./roadmap.md#non-goals-v1)                                      | [why-codemap.md § What Codemap is not](./why-codemap.md#what-codemap-is-not) (consumer-facing framing) — links here; [research/](./research/) notes link here, never re-list |
| **Domain term definitions** (FileRow vs `files`, recipe vs query, schema vs DDL, hub vs barrel, fan-in vs fan-out, …)                                                                                                                                                                                                   | [glossary.md](./glossary.md)                                                             | Other docs link to a glossary entry on first use; never inline a definition that conflicts                                                                                   |

---

## Document Lifecycle

Every doc here falls into one of four types. New content fits an existing type, or absorbs into an existing file — it does not spawn a new top-level doc by default.

### Types

| Type          | Folder                                                                                                                      | Lifecycle                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Reference** | root (`architecture.md`, `agents.md`, `benchmark.md`, `golden-queries.md`, `packaging.md`, `glossary.md`, `why-codemap.md`) | Lives forever. Kept current per Rules 4, 7, 9.                                                            |
| **Roadmap**   | root (`roadmap.md`, single file)                                                                                            | Lives forever. Items move in (new findings) and out (per Rule 2).                                         |
| **Plan**      | `plans/<name>.md`                                                                                                           | Created when work commits. Deleted when work ships (per Rule 3).                                          |
| **Research**  | `research/<topic>.md`                                                                                                       | Created on demand for a third-party scan or evaluation. Closed per [Closing research](#closing-research). |

Backlogs, frameworks, and decisions don't get their own top-level file. They fold into one of the four:

- **Backlogs** of open items → a section in `roadmap.md`.
- **Frameworks / playbooks** → `architecture.md` if Codemap-internal, or `.agents/rules/` / `.agents/skills/` if project-wide policy.
- **Decisions of record** from concluded research → lift into the relevant reference doc; the research file's job is the evaluation, not the decision.

### Existence test (apply on every doc-touching PR)

A file earns its place if it meets at least one of:

1. **Source code or another doc cites it** (grep finds the path).
2. **It documents durable policy or framework** unavailable elsewhere.
3. **It tracks open work** (open audit findings, in-flight plan, roadmap items).
4. **It carries unique historical context** that `git log` + `architecture.md` cannot reconstruct.

If none → fold any salvageable content into roadmap / architecture / glossary, fix the cross-refs, delete the file.

### Closing research

A research note's job is the evaluation. When it concludes:

- **Adopted** → lift the decisions-of-record into the relevant reference doc; slim the note to a "What shipped" appendix linking to canonical homes (precedent: [research/competitive-scan-2026-04.md](./research/competitive-scan-2026-04.md)).
- **Rejected** → add `Status: Rejected (YYYY-MM-DD) — <one-line reason>` at the top. Keep the file. Don't delete; the rejection rationale saves the next agent from re-litigating.
- **Open** → stays in `research/` with no status header (open is the default).

### Top-level cap

Adding a new top-level doc requires:

1. The topic doesn't fit any existing root-level doc.
2. The new file passes the existence test on day one.
3. [File Ownership](#file-ownership) table updated in the same PR.

When in doubt, default to absorbing into the closest existing root-level file (usually `roadmap.md` for forward-looking work, `architecture.md` for shipped behavior, `glossary.md` for terminology, `research/` for snapshot notes).

---

## Naming Conventions

- **`plans/` files**: `<feature-name>.md` — the folder provides "plan" context, don't add a `-plan` suffix.
- **`research/` files**: `<topic>-YYYY-MM.md` for dated snapshots (e.g. `competitive-scan-2026-04.md`); `<tool-name>.md` for ongoing tool evaluations.
- **Top-level files**: descriptive domain noun (`architecture.md`, `glossary.md`, `roadmap.md`) — no prefix or suffix.

---

## Conventions

Stylistic addendum to the rules above:

- **CLI flags and examples** — canonical [README.md § CLI](../README.md#cli). Other docs **summarize and link**; do not copy full flag lists. **Implementation paths** (`src/cli/…`, **`QUERY_RECIPES`**) belong in [architecture.md § CLI usage](./architecture.md#cli-usage) only.
- **This repo:** `bun run dev` is **`bun src/index.ts`**; `bun run build` → tsdown → `dist/`; `bun run clean` / `bun run check-updates` — see [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md).
- **Contributors:** branch + PR into **`main`** ([CI](../.github/workflows/ci.yml)), `bun run check`, JSDoc on public API.
