# Codemap — documentation index

Technical docs for **[@stainless-code/codemap](https://github.com/stainless-code/codemap)**.

**Start here:** [../README.md](../README.md) (install, CLI, API, dev commands). **This folder** is deeper reference — pick a row below.

## File Ownership

Each topic has exactly one canonical file. Other files cross-reference by relative path, never duplicate.

| File                                          | Topic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [why-codemap.md](./why-codemap.md)            | Why index + SQL for agents (speed, tokens, accuracy). Anti-pitch ([When to reach for something else](./why-codemap.md#when-to-reach-for-something-else)) and [alternatives comparison](./why-codemap.md#codemap-vs-alternatives). Good first read after the readme.                                                                                                                                                                                                                                                |
| [architecture.md](./architecture.md)          | Schema, layering, CLI internals, API, [**User config**](./architecture.md#user-config) (Zod), parsers, [Key Files](./architecture.md#key-files).                                                                                                                                                                                                                                                                                                                                                                   |
| [glossary.md](./glossary.md)                  | Canonical term definitions. Disambiguates pairs like `FileRow` vs `files` table, recipe vs query, schema vs DDL, hub vs barrel.                                                                                                                                                                                                                                                                                                                                                                                    |
| [agents.md](./agents.md)                      | **`codemap agents init`** — bundled **`templates/agents/`** (thin pointer files) → **`.agents/`** in consumer projects; full content served live by **`codemap skill`** / **`codemap rule`** + **`codemap://skill`** / **`codemap://rule`** from `templates/agent-content/`; section assembler + `*.gen.md` renderers, **[pointer protocol](./agents.md#pointer-protocol-and-staleness-detection)** + staleness nag, per-file IDE symlink/copy, **`--interactive`**, **`--mcp`**, **`.gitignore` / `.codemap.*`**. |
| [benchmark.md](./benchmark.md)                | [**Indexing another project**](./benchmark.md#indexing-another-project) · [**Benchmark script**](./benchmark.md#the-benchmark-script) · [**Query stdout (table vs JSON)**](./benchmark.md#query-stdout-table-vs-json-benchmarkquery) · [**Custom scenarios**](./benchmark.md#custom-scenarios-codemap_benchmark_config) (`CODEMAP_BENCHMARK_CONFIG`) · [**Agent eval harness**](./benchmark.md#agent-eval-harness) · [`fixtures/minimal/`](../fixtures/minimal/).                                                  |
| [golden-queries.md](./golden-queries.md)      | Golden `query` **design & policy** (Tier A/B, no proprietary trees); runner: [scripts/query-golden.ts](../scripts/query-golden.ts).                                                                                                                                                                                                                                                                                                                                                                                |
| [fixtures/golden/](../fixtures/golden/)       | [scenarios.json](../fixtures/golden/scenarios.json) + [minimal/](../fixtures/golden/minimal/) — **`bun run test:golden`**; Tier B: [scenarios.external.example.json](../fixtures/golden/scenarios.external.example.json) + **`bun run test:golden:external`** ([benchmark § Fixtures](./benchmark.md#fixtures)).                                                                                                                                                                                                   |
| [fixtures/benchmark/](../fixtures/benchmark/) | Tracked [scenarios.example.json](../fixtures/benchmark/scenarios.example.json) — copy to `*.local.json` (gitignored) for [`CODEMAP_BENCHMARK_CONFIG`](./benchmark.md#custom-scenarios-codemap_benchmark_config).                                                                                                                                                                                                                                                                                                   |
| [fixtures/qa/](../fixtures/qa/)               | [prompts.external.template.md](../fixtures/qa/prompts.external.template.md) — optional chat QA prompts for an external index (`*.local.md` gitignored).                                                                                                                                                                                                                                                                                                                                                            |
| [packaging.md](./packaging.md)                | **`CHANGELOG.md` / `dist/` / `templates/`** on npm, **engines**, [**Node vs Bun**](./packaging.md#node-vs-bun), [**Releases**](./packaging.md#releases) (Changesets; **`bun run version`** + oxfmt **`CHANGELOG.md`**).                                                                                                                                                                                                                                                                                            |
| [roadmap.md](./roadmap.md)                    | Forward-looking [**Backlog**](./roadmap.md#backlog) and [**Non-goals**](./roadmap.md#non-goals-v1) (not a `src/` inventory).                                                                                                                                                                                                                                                                                                                                                                                       |
| [plans/](./plans/)                            | One `<feature-name>.md` per in-flight plan. Created on demand — don't add the `-plan` suffix; the folder provides context. See folder contents for the current in-flight set; avoid maintaining a duplicate inline list.                                                                                                                                                                                                                                                                                           |
| [audits/](./audits/)                          | Targeted architecture / performance / lifecycle audits. None open.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [research/](./research/)                      | Dated snapshot notes for **open** evaluations. Closed adopted notes delete after lift; rejected notes keep a one-line status header only.                                                                                                                                                                                                                                                                                                                                                                          |

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
8. **Research notes get closed** — **default: lift + delete.** When adopt items ship, move decisions-of-record into canonical homes (`architecture.md`, `glossary.md`, `roadmap.md`, a plan, `.agents/rules/`). **Delete** the research file once nothing in source cites it by path. **Rejected-only keep:** add `Status: Rejected (YYYY-MM-DD) — <one-line reason>` and stop — no "analytical history" appendices. **Slim + keep** only when inbound source cites (rule numbers, `NOTE(...)`, tests) would orphan — then keep cited sections + status header, not the full evaluation prose. Do **not** retain "What shipped" inventory tables or `git log` / `git show` recovery rows in living docs.
9. **New term ⇒ update [glossary.md](./glossary.md) in the same PR** — when a PR introduces a new domain noun / verb / acronym (table name, recipe id, parser name, schema column), add or update its entry. Disambiguations (e.g. `FileRow` TS shape vs `files` SQLite table) take priority over single defs.
10. **Core surface change ⇒ check which agent-content layer it belongs to** — the v1 pointer pattern split the agent surface in two:
    - **Auto-flows (no template edit needed)** — recipe additions (`templates/recipes/*.{sql,md}`), schema additions (`src/db.ts` `createTables()`). Both surfaces via `*.gen.md` renderers in `src/application/agent-content.ts` and the served skill regenerates on every fetch.
    - **Narrative changes** — new CLI flag / output mode / MCP tool / HTTP route / output-shape change → edit the relevant hand-written section in **`templates/agent-content/skill/*.md`** (single source of truth; `codemap skill` (CLI), `codemap://skill` (MCP), and `GET /resources/{encoded-uri}` against `codemap serve` (HTTP) all serve the same assembled body).
    - **Pointer-shape changes** (frontmatter schema, fetch instructions, marker comments) → edit `templates/agents/{rules/codemap,skills/codemap/SKILL}.md` AND bump `EXPECTED_POINTER_VERSION` in `agent-content.ts` so consumers see the staleness nag and re-run `codemap agents init --force`.

    This repo's `.agents/{rules/codemap,skills/codemap/SKILL}.md` are thin pointers too (regenerate via `bun src/index.ts agents init --force` if pointer shape drifts) — they used to be the dev-side "second copy" to keep in sync; that obligation is gone.

---

## Single source of truth (do not duplicate)

Cross-cutting topics that span multiple files. Each has exactly one canonical home; other files link, never copy.

| Topic                                                                                                                                                                                                                                                                                                                                                                                        | Canonical doc                                                                            | Elsewhere                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime splits (SQLite, workers, globs, JSON config I/O)                                                                                                                                                                                                                                                                                                                                     | [packaging § Node vs Bun](./packaging.md#node-vs-bun) — **the table lives here**         | [architecture § Runtime](./architecture.md#runtime-and-database) links here; do not copy the table                                                                                                        |
| **`<state-dir>/config.{ts,js,json}`** shape / Zod validation                                                                                                                                                                                                                                                                                                                                 | [architecture § User config](./architecture.md#user-config)                              | Root [README](../README.md) points here for config shape                                                                                                                                                  |
| **`codemap agents init`**: pointer pattern (**`templates/agents/`** → consumer-disk pointers; **`templates/agent-content/`** → live-served full content), **`codemap skill`** / **`codemap rule`**, **`codemap://skill`** / **`codemap://rule`**, section assembler + `*.gen.md` renderers, **`EXPECTED_POINTER_VERSION`** + staleness nag, **`--force`**, IDE matrix, per-file symlink/copy | [agents.md](./agents.md)                                                                 | Link here; do not paste the integration table into README or packaging                                                                                                                                    |
| **`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / Copilot** — managed **`codemap-pointer`** sections, merge vs **`--force`**                                                                                                                                                                                                                                                                       | [agents.md § Pointer files](./agents.md#pointer-files)                                   | Link here; do not duplicate the situation table                                                                                                                                                           |
| End-user CLI (index, **`query --json`**, **`query --recipe`**, **`query --recipes-json`**, **`query --print-sql`**, **`skill`**, **`rule`**, agents, flags, env) — query has no row cap; use SQL **`LIMIT`**; **`--json`** errors include SQL, DB open, and bootstrap failures; bundled `templates/agent-content/skill/*.md` examples default to **`--json`**                                | [../README.md § CLI](../README.md#cli)                                                   | [architecture § CLI usage](./architecture.md#cli-usage) summarizes and links back; [agents.md](./agents.md)                                                                                               |
| Golden query regression (`test:golden`, `test:golden:external`, `--update`)                                                                                                                                                                                                                                                                                                                  | [golden-queries.md](./golden-queries.md)                                                 | CONTRIBUTING § Golden queries; [benchmark § Fixtures](./benchmark.md#fixtures)                                                                                                                            |
| Agent eval harness (`test:agent-eval`, `scripts/agent-eval/`)                                                                                                                                                                                                                                                                                                                                | [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness)                      | Reuses golden scenarios via `goldenId`; probe + live + log structural cost A/B; exploratory MCP vs agent findings in [research/agent-eval-findings-2026-05.md](./research/agent-eval-findings-2026-05.md) |
| **`CODEMAP_BENCHMARK_CONFIG`** (per-repo benchmark JSON)                                                                                                                                                                                                                                                                                                                                     | [benchmark § Custom scenarios](./benchmark.md#custom-scenarios-codemap_benchmark_config) | [fixtures/benchmark/scenarios.example.json](../fixtures/benchmark/scenarios.example.json) only                                                                                                            |
| `bun run qa:external` — index + disk checks + `benchmark.ts` on **`CODEMAP_*`**                                                                                                                                                                                                                                                                                                              | [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md)                                    | [scripts/qa-external-repo.ts](../scripts/qa-external-repo.ts) (invocation only)                                                                                                                           |
| **Non-goals (v1)** — what Codemap deliberately doesn't do (full-text search, LSP, static analysis, visualization, daemon, deep intent classification)                                                                                                                                                                                                                                        | [roadmap.md § Non-goals](./roadmap.md#non-goals-v1)                                      | [why-codemap.md § When to reach for something else](./why-codemap.md#when-to-reach-for-something-else) (consumer-facing framing) — links here; [research/](./research/) notes link here, never re-list    |
| **Domain term definitions** (FileRow vs `files`, recipe vs query, schema vs DDL, hub vs barrel, fan-in vs fan-out, …)                                                                                                                                                                                                                                                                        | [glossary.md](./glossary.md)                                                             | Other docs link to a glossary entry on first use; never inline a definition that conflicts                                                                                                                |

---

## Document Lifecycle

Every doc here falls into one of five types. New content fits an existing type, or absorbs into an existing file — it does not spawn a new top-level doc by default.

### Types

| Type          | Folder                                                                                                                      | Lifecycle                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| **Reference** | root (`architecture.md`, `agents.md`, `benchmark.md`, `golden-queries.md`, `packaging.md`, `glossary.md`, `why-codemap.md`) | Lives forever. Kept current per Rules 4, 7, 9.                                                            |
| **Roadmap**   | root (`roadmap.md`, single file)                                                                                            | Lives forever. Items move in (new findings) and out (per Rule 2).                                         |
| **Plan**      | `plans/<name>.md`                                                                                                           | Created when work commits. Deleted when work ships (per Rule 3).                                          |
| **Audit**     | `audits/<topic>.md`                                                                                                         | Created at audit time. Closed per the docs-governance skill's audit lifecycle.                            |
| **Research**  | `research/<topic>.md`                                                                                                       | Created on demand for a third-party scan or evaluation. Closed per [Closing research](#closing-research). |

Backlogs, frameworks, and decisions don't get their own top-level file. They fold into one of the five:

- **Backlogs** of open items → a section in `roadmap.md`.
- **Frameworks / playbooks** → `architecture.md` if Codemap-internal, or `.agents/rules/` / `.agents/skills/` if project-wide policy.
- **Decisions of record** from concluded research → lift into the relevant reference doc; the research file's job is the evaluation, not the decision.

### Existence test (apply on every doc-touching PR)

A file earns its place if it meets at least one of:

1. **Source code or another doc cites it** (grep finds the path).
2. **It documents durable policy or framework** unavailable elsewhere.
3. **It tracks open work** (open audit findings, in-flight plan, roadmap items).
4. **Inbound source cites require a slim stub** — JSDoc, rules, tests, or plans link to this file by path/anchor; deletion would orphan them. (Not "interesting history" — if only git could reconstruct it, delete.).

If none → fold any salvageable content into roadmap / architecture / glossary, fix the cross-refs, delete the file.

### Closing research

A research note's job is the evaluation. When it concludes:

- **Adopted** → lift the decision-of-record into the relevant reference doc; **delete** the research file when nothing cites it by path. Rejected-only keep per Rule 8 above.
- **Rejected** → add `Status: Rejected (YYYY-MM-DD) — <one-line reason>` at the top. Keep the file. Don't delete; the rejection rationale saves the next agent from re-litigating.
- **Open** → stays in `research/` with no status header (open is the default).

### Top-level cap

Adding a new top-level doc requires:

1. The topic doesn't fit any existing root-level doc.
2. The new file passes the existence test on day one.
3. [File Ownership](#file-ownership) table updated in the same PR.

When in doubt, default to absorbing into the closest existing root-level file (usually `roadmap.md` for forward-looking work, `architecture.md` for shipped behavior, `glossary.md` for terminology, `research/` for snapshot notes).

### Closing audits

When an audit closes, lift shipped work into canonical homes (`architecture.md`, a plan, `.agents/lessons.md`, `roadmap.md` backlog). **Do not leave tombstones** — no pointer table, no "recover via `git log --follow -- <deleted-path>`" rows in living docs. Deleted audit text lives in git history only; cite the shipping PR or commit when closure needs a durable anchor.

- **Delete** when the re-derivable test passes (findings visible in source / no source-cites / no unique policy) — see [docs-governance § Closing an audit](../../.agents/skills/docs-governance/SKILL.md#closing-an-audit).
- **Slim + keep** in `audits/` when the file carries decisions-of-record, source back-references, or methodology not captured elsewhere — add a `Status: Closed` header.
- **Absorb into a plan** when the audit is the synthesis substrate for in-flight work — the plan's provenance block owns recovery (`git show <sha> -- docs/audits/…` belongs there, not in `docs/README.md`).

---

## Naming Conventions

- **`plans/` files**: `<feature-name>.md` — the folder provides "plan" context, don't add a `-plan` suffix.
- **`research/` files**: `<topic>-YYYY-MM.md` for dated snapshots; `<tool-name>.md` for ongoing tool evaluations. **Delete after lift** when adopted (Rule 8).
- **Top-level files**: descriptive domain noun (`architecture.md`, `glossary.md`, `roadmap.md`) — no prefix or suffix.

---

## Conventions

Stylistic addendum to the rules above:

- **CLI flags and examples** — canonical [README.md § CLI](../README.md#cli). Other docs **summarize and link**; do not copy full flag lists. **Implementation paths** (`src/cli/…`, **`QUERY_RECIPES`**) belong in [architecture.md § CLI usage](./architecture.md#cli-usage) only.
- **This repo:** `bun run dev` is **`bun src/index.ts`**; `bun run build` → tsdown → `dist/`; `bun run clean` / `bun run check-updates` — see [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md).
- **Contributors:** branch + PR into **`main`** ([CI](../.github/workflows/ci.yml)), `bun run check`, JSDoc on public API.
