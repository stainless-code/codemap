# Roadmap

Forward-looking plans only — **not** a mirror of `src/`. **Doc index:** [README.md](./README.md). **Design / ship:** [architecture.md](./architecture.md), [packaging.md](./packaging.md). **Shipped features** (adapters, fixtures, `codemap agents init` — [agents.md](./agents.md)) live in `src/` and linked docs — not enumerated here.

**Public curated subset** (user-facing): [`apps/docs/content/reference/roadmap.mdx`](../apps/docs/content/reference/roadmap.mdx) → `/reference/roadmap`. Keep this file as the maintainer SSOT; trim the public page by hand when Next / Backlog / non-goals move.

---

## Next

- **Public docs site + brand** — Blume `apps/docs` at `https://stainless-code.com/codemap`. Plan: [`plans/docs-site.md`](./plans/docs-site.md).
- **Community language adapters** — optional packages (e.g. Tree-sitter) with a **peerDependency** on `@stainless-code/codemap` and a public **registration** API beyond built-ins in [`src/adapters/`](../src/adapters/).
- **Agent tooling** — evaluate [TanStack Intent](https://tanstack.com/intent/latest/docs/overview) for versioned skills in `node_modules` (optional; **`codemap agents init`** remains the default).

---

## Strategy

| Layer                  | Role                                                                         |
| ---------------------- | ---------------------------------------------------------------------------- |
| **Core**               | Schema, incremental indexing, git invalidation, `dependencies`, CLI, `query` |
| **Community adapters** | Future optional packages; **peerDependency** on `@stainless-code/codemap`    |

---

## Non-goals (v1)

Codemap stays a structural-index primitive that other tools can consume. Two layers below: **Moats** are load-bearing — eroding either turns codemap into yet-another-tool-in-the-cohort instead of the predicate-shaped specialist. **Floors** are real shape constraints but not differentiators; soft v1 product-shape preferences. Consumer-facing framing of when to reach for codemap vs alternatives lives in [`why-codemap.md § When to reach for something else`](./why-codemap.md#when-to-reach-for-something-else).

### Moats (load-bearing)

Every PR reviewer defends these. The reviewer tests embedded below are the canonical filters for any new verb / column / engine.

- **A. SQL is the API.** Every capability is a recipe (saved query) or a primitive recipes can compose — never a pre-baked verdict. SQL is a durable, well-known query language; agents compose any predicate without us deciding which questions are important. The moment a CLI verb returns `pass`/`fail` _without_ a recipe form behind it, the moat erodes — the tool becomes "yet another linter with opinions baked in" instead of "the database your agent queries." **Verdicts are an OUTPUT mode** (e.g. `--format sarif`, `audit --base <ref>` deltas), never a primitive. **Reviewer test for any new verb:** "is this also expressible as `query --recipe <id>`?"
- **B. Extracted structure ≥ verdicts.** Schema breadth is the substrate every recipe layers on. CSS (`css_variables` / `css_classes` / `css_keyframes`), `markers`, `type_members`, `type_heritage`, `calls.caller_scope`, `components.hooks_used`, the substrate-extraction tier (`scopes` / `references` / `bindings` / `function_params` / `runtime_markers` / `test_suites` / `re_export_chains` / `module_cycles` / `file_metrics` / `import_specifiers` / `jsx_elements` / `jsx_attributes` / `async_calls` / `try_catch` / `decorators` / `jsdoc_tags` / `dynamic_imports`) — these are codemap-specific extractions; their richness directly determines what JOINs are expressible and which agent questions get clean answers. Slimming the schema for theoretical perf / simplicity is a regression unless the column is empirically unread. **Reviewer test for any "drop column X" PR:** "what recipe (bundled or hypothetical) does this kill?"

### Floors (v1 product-shape)

Soft constraints — describe shipped reality. Decided-but-unshipped flips live in [§ Backlog](#backlog), not here.

- **Full-text search default-on** — opt-in FTS5 ships per the `--with-fts` CLI flag / `fts5: true` config field (default OFF; populates `source_fts` virtual table at index time). Default-on decision gated on measurement — plan: [`plans/fts-default-on-evaluation.md`](./plans/fts-default-on-evaluation.md).
- **No LSP engine** — no rename / go-to-definition / hover types. Read-side LSP-adjacent primitives (`show` / `snippet` / `impact`) ship as CLI / MCP / HTTP verbs (see [README § CLI](../README.md#cli)). LSP **diagnostic-push** server (recipes-as-`Diagnostic[]`) is a separate roadmap item tracked at [`plans/lsp-diagnostic-push.md`](./plans/lsp-diagnostic-push.md).
- **No opinionated rule engine / fix engine / severity levels** — verdict-shaped lints (`knip`, `jscpd`, `eslint`) are a different product class. Predicate-as-API recipes (`untested-and-dead`, `worst-covered-exports`, `visibility-tags`, `barrel-files`, `deprecated-symbols`, …) are in scope and shipping; they're upstream of [Moat A](#moats-load-bearing). **Suppression comments** ship as opt-in substrate (`// codemap-ignore-{next-line,file} <recipe-id>` → `suppressions` table; recipes JOIN to honor) — no severity, no suppression-by-default, no universal-honor; consumer-chosen, not policy.
- **No renderer runtime** — skyline / ASCII art / animated diagrams; the index emits structured rows. Shape-only output formatters (`--format mermaid` shipped; `--format sarif` / `annotations` for CI; D2 / Graphviz on demand) are in scope.
- **No daemon for one-shot CLI** — sub-100ms cold-start floor preserved for `query` / `show` / `snippet` / etc.; they spawn no watcher. The inherently long-running modes default-ON since 2026-05: `mcp` / `serve` boot the chokidar watcher in-process so every tool reads a live index. Pass `--no-watch` or set `CODEMAP_WATCH=0` to opt out for ephemeral / fire-and-forget invocations. Standalone `codemap watch` decouples the watcher from a transport.
- **Embedded intent classification** beyond the thin keyword classifier in `codemap context --for "<intent>"` — deeper routing belongs in the agent host (Cursor / Claude Code / MCP client).
- **No LLM in the box** — embedded intent classification, semantic search over symbol names, embedding-driven recipe routing — the agent host owns this. We supply structure; they supply meaning.
- **No opinionated autofix engine** — codemap does not decide fixes like ESLint / codemod tools do. The shipped `codemap apply` path is a substrate-shaped executor: recipes or agents provide explicit diff rows, and codemap validates / applies those rows with confirmation gates.
- **No runtime tracing** — production beacons / live execution telemetry are a different product class (live process data, not static analysis). Post-mortem coverage ingestion (`codemap ingest-coverage` reading Istanbul / LCOV / V8 protocol dumps from `NODE_V8_COVERAGE=...`) is the static-side adjacent capability — local-only, no SaaS aggregation.
- **No JS execution at index time** — config files via `import()` is the only exception; recipe SQL is parsed but never `eval`'d. Plugin layer (tracked at [`plans/c9-plugin-layer.md`](./plans/c9-plugin-layer.md)) must respect this — plugins describe rules in static config, not by running arbitrary code. _Safety floor — protects supply-chain attack surface._
- **No telemetry upload** — codemap never sends usage data anywhere. Local recipe-recency tracking is opt-out and stays in `.codemap/index.db`. _Floor exists to resist accumulation pressure._
- **No remote-repo cloning** — `codemap github.com/x/y` (clone-and-index a remote URL) is demoware, not a real workflow; the user's local checkout is always the source of truth. Indexing another tree is `--root <path>` / `CODEMAP_ROOT`, never a network fetch. _Rejected in PR #23._
- **No split-brain incremental index** — incremental / `--files` paths must update every table recipes and MCP tools query (core graph, FTS, heritage, bindings, …) for changed files in the **same pass**. Never ship lazy secondary surfaces where symbol lookup is fresh but body search (or any other recipe path) is stale. Incremental perf work belongs in [§ Perf-triangulation deferrals (trigger-gated)](#perf-triangulation-deferrals-trigger-gated), not deferred consistency.

---

## Backlog

### Agent & indexing ops

Prioritized agent & indexing ops queue (2026-05). Reference: [agents.md](./agents.md), [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness). Shipped milestones: [agents.md § Shipped agent & indexing milestones](./agents.md#shipped-agent--indexing-milestones).

**P2 — strategic (trigger-gated where noted)**

- [ ] **Framework route extraction** — Express / React Router / NestJS `http_routes` substrate. Plan: [`plans/framework-route-extraction.md`](./plans/framework-route-extraction.md). Blocked on C.9 contract. Effort: L.
- [ ] **Callback dispatch heuristics (EventEmitter / setState→render)** — extends shipped JSX tracer ([#164](https://github.com/stainless-code/codemap/pull/164); `synthesis.heuristicCalls`). Separate design from oxc limits. Effort: M.
- [ ] **Cross-project MCP root** — optional `root` on tools + DB cache. Plan: [`plans/cross-project-mcp-root.md`](./plans/cross-project-mcp-root.md). Effort: M.
- [ ] **FTS default-on evaluation** — measure DB size tax; maybe flip default. Plan: [`plans/fts-default-on-evaluation.md`](./plans/fts-default-on-evaluation.md). Effort: S–M.

### Agent session & warm-path economics

Long-running MCP / HTTP sessions dominate agent workflows; one-shot CLI keeps the sub-100ms cold-start floor ([§ Floors — No daemon for one-shot CLI](./roadmap.md#floors-v1-product-shape)). Items here apply to **`mcp` / `serve` / `watch` only** unless noted.

- [ ] **MCP shared daemon per project** — one watcher + one SQLite writer per indexed root; Unix socket / named pipe so concurrent agent sessions share a live index instead of each spawning watchers and contending on WAL. Complements perf item **6.1** (read pool) but is a separate write-side + lifecycle concern. Effort: L.
- [x] **Codebase map in bootstrap responses** — `context` ships `map_id` + `codebase_map` (hub paths, codemap CLI/MCP routing hints); MCP initialize `instructions` append `map_id` + top hubs. Opt-out: `--no-codebase-map` / `include_codebase_map: false`; omitted when `compact`. See [architecture.md § Context wiring](./architecture.md#context-wiring).
- [ ] **`--mcp-invocation global|auto` flag** — explicit override to force global `codemap` on PATH vs PM-aware auto-resolve. Effort: S.
- [ ] **`agents init` uninstall (teardown)** — symmetric inverse of init for failed pilots, template mistakes, or leaving a repo: remove codemap-managed MCP entries, pointer sections, and IDE symlinks only (same scoped paths as init; never delete user-authored `.agents/` siblings). `--target` filter, `--yes` non-interactive. Not the happy-path docs story — adoption stays `init --mcp --git-hooks` + committed `.agents/`. Effort: S.

### Recipe & audit enrichment

Predicate-as-API only — enrich row shape and audit deltas; no standalone pass/fail verdict primitive ([Moat A](./roadmap.md#moats-load-bearing)).

- [x] **Tiered lookup fast paths** — `show` / `name:Token` (no wildcards) route to equality index (`idx_symbols_name_covering`); substring / FTS / multi-field stay slow tier. MCP + CLI help document tiers. See [architecture.md § CLI usage](./architecture.md#cli-usage).

### Distribution & evaluation depth

- [ ] **Zero-deps shell installer** — curl\|sh (and PowerShell) platform binary fetch alongside npm; optional bundled Node/Bun runtime for consumers without a JS toolchain. Plan: [`plans/zero-deps-shell-installer.md`](./plans/zero-deps-shell-installer.md). Effort: L. See also [packaging.md](./packaging.md).
- [ ] **Scripted dual-agent harness** — task JSON + golden expected answers; spawn MCP-on / MCP-off LLM agents on the same structural tasks; score tool count + answer diff against index ground truth. Extends `scripts/agent-eval/` (dev-only; not npm). Complements probe/live/log arms in [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness). Effort: M.
- [ ] **Agent eval: quality × tokens × wall** — extend [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness) with scored task rubrics (file/function/snippet correctness) on named public corpora, reported alongside structural tool cost. Complements **Falsifiable benchmark CI** below; same external fixture policy (public repos only). Effort: M.

---

### Core substrate & platform

- [ ] **Substrate extraction (tiers 7–8, 13)** — CSS rule depth, project meta, ORM/SQL tracking, and other AST surfaces discarded at parse time. Tiers 1–6 + partial 9–12 shipped. Plan: [`plans/substrate-extraction.md`](./plans/substrate-extraction.md). Effort: XL (sequential tracer bullets).
- [ ] **C.9 framework plugin layer** — static entry-point hints on `files` (`is_entry` or `entry_annotations`) to sharpen reachability-predicate recipes (`untested-and-dead`, `unimported-exports`, future `dead-files-by-reachability`). Plugins: declarative globs + optional AST-parse of tool config files (Vite/Next/Vitest, …); activate via config `plugins:` list and/or package `enablers` — **no JS eval at index time**. Plan: [`plans/c9-plugin-layer.md`](./plans/c9-plugin-layer.md). Effort: XL; ships last in the impact-vs-cadence sequence (see plan § Shipping cadence).
- [ ] **LSP diagnostic-push + VSCode extension** — recipes-as-`Diagnostic[]` server + paired extension; explicitly **not** a go-to-def / references shim (`tsserver` covers those). Plan: [`plans/lsp-diagnostic-push.md`](./plans/lsp-diagnostic-push.md). Effort: XL; soft ordering after C.9 for cleaner squigglies on framework files.
- [ ] **`organize-imports` diff-shape recipe** — deterministic single-file import sort/group; `imports.line_number` + `source` substrate sufficient. Review-first (`auto_fixable: false`). Effort: S.
- [ ] **`codemap-to-tsmorph` Path B adapter** — separate package experiment: `query_recipe` discovery → `ts-morph` / `jscodeshift` transforms for AST-shape edits codemap's substring executor defers (see [architecture § Rejected apply-path alternatives](./architecture.md#apply--input-modes-transport-and-policy)). Not an in-tree AST writer (Path A rejected). Effort: M.
- [ ] **Apply write-safety hardening** — close apply TOCTOU: SHA-256 `hashContent` at phase-1 read, recheck disk hash immediately before phase-2 write (`file content changed` conflict); `fsync` temp file before `rename`; skip files with mixed CRLF/LF (`mixed line endings`). Preserves all-or-nothing on any conflict. Plan: [`plans/apply-write-safety.md`](./plans/apply-write-safety.md). Effort: L.
- [ ] **`history` table** (deferred — revisit-triggered) — temporal queries: "when did symbol X get `@deprecated`?", "coverage trend over last 50 commits", "files that became dead this week". `audit --base <ref>` covers the most-common temporal question (PR-scoped diff) without schema growth, so the table earns its place only when bigger questions emerge. Two shapes (per-commit snapshots ~N × DB size; append-only event log heavier CTE walks); both pay an N-reindexes backfill cost (~30s per reindex). **Revisit triggers:** two consumers ship `jq`-based "audit-runs-over-time" workflows, OR `query_baselines` evolution becomes a recurring agent need.
- [ ] **`codemap audit` verdict + thresholds** (v1.x) — `verdict: "pass" | "warn" | "fail"` driven by an `audit.deltas[<key>].{added_max, action}` field on the config object (`.codemap/config.{ts,js,json}`). Triggers: two consumers ship `jq`-based threshold scripts with similar shapes, OR one consumer asks with a concrete config sketch. Until then, raw deltas + consumer-side `jq` is the CI exit-code idiom. **Likely accelerant:** the Marketplace Action (next item) shipping is the most plausible path to firing the trigger — once `- uses: stainless-code/codemap@v1` is the dominant CI path, real `jq` threshold scripts will surface.
- [ ] **GitHub Marketplace Action — listing** — `MARKETPLACE.md`, `v1.0.0` / floating `v1` tags, Marketplace setup, sacrificial-repo smoke, blocking `action-smoke` once Action tag exists. Core Action slices already in-tree (`action.yml`, `--ci`, SARIF/annotations, PM detect, dogfood smoke, opt-in pr-comment). Plan: [`plans/github-marketplace-action.md`](./plans/github-marketplace-action.md). Effort: S.
- [ ] **Falsifiable benchmark CI on named external fixtures** — structural-cost A/B (indexed queries vs `find` + `grep` + `Read`-loop discovery) on zod, fastify, vue-core, next.js. Numbers land in [`docs/benchmark.md`](./benchmark.md); headline figures surface in `MARKETPLACE.md` only after external runs land. Harness: [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness) + external fixture extension; pair with **Agent eval: quality × tokens × wall** for scored completion metrics. **Partial:** manual [`.github/workflows/agent-eval-external.yml`](../.github/workflows/agent-eval-external.yml) for in-repo fixture paths (not zod/fastify/nightly). Effort: M. **Self-index regression guardrail shipped** (#96): `bun run check:perf-baseline` + weekly scheduled workflow (demoted from PR hard gate — GHA runner variance).
- [ ] **In-repo test bench scale (optional)** — if `fixtures/minimal` outgrows one corpus: add committed `fixtures/bench/` or rename `minimal`→`bench`. Harness map: [`testing-coverage.md`](./testing-coverage.md), [`fixtures/README.md`](../fixtures/README.md).

### Perf-triangulation deferrals (trigger-gated)

- [ ] **Perf-triangulation deferrals** — Tier 5.2 / 5.4 / 5.6 / 5.7 / 6.1 / 6.2 from [`plans/perf-triangulation-rollout.md`](./plans/perf-triangulation-rollout.md) (Phases 0-2 + Phase 5 shipped; per-model audit + triangulation source content consolidated into the rollout plan 2026-05-18). Each ships when its trigger fires:
  - **5.2 IPC encoding (CBOR / transferables)** — after a `parse_ms_pure_worker` instrumentation split shows IPC > ~30% of `parse_ms`.
  - **5.4 `extractMarkers` lineMap reuse on TS/JS** — if marker extraction becomes hot on >10k-file trees (~1ms on this repo today).
  - **5.6 group-by bucketizer cache per root** — when a `mcp` / `serve` user reports slow repeated `query --group-by owner|package`.
  - **5.7 sync git subprocess collapse** — if git-subprocess time becomes measurable in incremental wall (Tier 2.3 mostly killed it).
  - **6.1 persistent read-only connection pool** — when `mcp` / `serve` indexing 10k+ trees reports contention. Scoped to long-running transports only, NOT one-shot CLI (GPT-5.5 caveat).
  - **6.2 CI dep install / `package-manager-detector` vendoring** — after timing existing CI install steps confirms meaningful savings.

  Architectural follow-ups (plan-PR-first): parse → insert pipeline overlap and AST cache — see [`plans/perf-triangulation-rollout.md`](./plans/perf-triangulation-rollout.md) Phase 3.

- [ ] **Repo-structure conversion (codemap itself: flat → monorepo)** — tracked decision, not a backlog item to ship. Default bias: stay flat until a trigger fires (C.9 community plugins ship as separate packages, OR a user asks for `codemap-core` library export, OR a second distro emerges). Full analysis + three options + reference layouts (oxc / knip / biome / vitest) + revisit triggers in [`plans/lsp-diagnostic-push.md § Repo-structure tradeoffs`](./plans/lsp-diagnostic-push.md#repo-structure-tradeoffs-canonical-home-for-the-monorepo-vs-flat-decision). Don't convert preemptively.
- [ ] **Monorepo / workspace awareness** — discover workspaces from `pnpm-workspace.yaml` / `package.json` and index per-workspace dependency graphs (separate from the codemap-itself repo-structure decision above; this is about indexing user repos)
- [ ] **Cross-agent handoff artifact** — _speculative_; layered prefix/delta JSON written on session-stop, read on session-start. Complementary to indexing rather than core to it; revisit if user demand emerges
- [ ] **Adapter scaffolding** — `codemap create-adapter --name [name]` generates adapter + test + fixture boilerplate; blocked on community adapter registration API (could land with manual registration)
- [ ] **Config loader** — two candidates: (a) [c12](https://unjs.io/packages/c12) — battle-tested (Nuxt/Nitro), adds extends, env overrides, RC files, watching; still executes config via `jiti`. (b) AST-based extraction with `oxc-parser` — faster, no side effects, safer in untrusted repos; can't handle async/dynamic configs, needs `import()` fallback. Current: native `import()` in `config.ts`
- [ ] Optional **GitHub Actions** `workflow_dispatch` — run golden/benchmark against a **public** corpus only (never private app code). Distinct from the shipped [agent-eval external workflow](../.github/workflows/agent-eval-external.yml) (in-repo fixtures only).
- [ ] **Sass / Less / SCSS:** [Lightning CSS](https://lightningcss.dev/) is CSS-only; preprocessors need a compile step before CSS parsing — see [architecture.md § CSS](./architecture.md#css--css-parserts-lightningcss)
- [ ] **[UnJS](https://unjs.io) adoption** — candidates: [`citty`](https://unjs.io/packages/citty) (CLI builder), [`pathe`](https://unjs.io/packages/pathe) (cross-platform paths), [`consola`](https://unjs.io/packages/consola) (structured logging), [`pkg-types`](https://unjs.io/packages/pkg-types) (typed `package.json`/`tsconfig.json`), [`c12`](https://unjs.io/packages/c12) (config loader — see config loader item above)
