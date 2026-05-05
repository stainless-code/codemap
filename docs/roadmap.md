# Roadmap

Forward-looking plans only — **not** a mirror of `src/`. **Doc index:** [README.md](./README.md). **Design / ship:** [architecture.md](./architecture.md), [packaging.md](./packaging.md). **Shipped features** (adapters, fixtures, `codemap agents init` — [agents.md](./agents.md)) live in `src/` and linked docs — not enumerated here.

---

## Next

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
- **B. Extracted structure ≥ verdicts.** Schema breadth is the substrate every recipe layers on. CSS (`css_variables` / `css_classes` / `css_keyframes`), `markers`, `type_members`, `calls.caller_scope`, `components.hooks_used` — these are codemap-specific extractions; their richness directly determines what JOINs are expressible and which agent questions get clean answers. Slimming the schema for theoretical perf / simplicity is a regression unless the column is empirically unread. **Reviewer test for any "drop column X" PR:** "what recipe (bundled or hypothetical) does this kill?"

### Floors (v1 product-shape)

Soft constraints — describe shipped reality. Decided-but-unshipped flips live in [§ Backlog](#backlog), not here.

- **Full-text search default-on** — opt-in FTS5 ships per the `--with-fts` CLI flag / `fts5: true` config field (default OFF; populates `source_fts` virtual table at index time). Default-on revisits a v2 size-tax measurement.
- **No LSP engine** — no rename / go-to-definition / hover types. Read-side LSP-adjacent primitives (`show` / `snippet` / `impact`) ship as CLI / MCP / HTTP verbs (see [README § CLI](../README.md#cli)). LSP **diagnostic-push** server (recipes-as-`Diagnostic[]`) is a separate roadmap item tracked at [`plans/lsp-diagnostic-push.md`](./plans/lsp-diagnostic-push.md).
- **No opinionated rule engine / fix engine / severity levels / suppression comments** — verdict-shaped lints (`knip`, `jscpd`, `eslint`) are a different product class. Predicate-as-API recipes (`untested-and-dead`, `worst-covered-exports`, `visibility-tags`, `barrel-files`, `deprecated-symbols`, …) are in scope and shipping; they're upstream of [Moat A](#moats-load-bearing).
- **No renderer runtime** — skyline / ASCII art / animated diagrams; the index emits structured rows. Shape-only output formatters (`--format mermaid` shipped; `--format sarif` / `annotations` for CI; D2 / Graphviz on demand) are in scope.
- **No daemon for one-shot CLI** — sub-100ms cold-start floor preserved for `query` / `show` / `snippet` / etc.; they spawn no watcher. The inherently long-running modes default-ON since 2026-05: `mcp` / `serve` boot the chokidar watcher in-process so every tool reads a live index. Pass `--no-watch` or set `CODEMAP_WATCH=0` to opt out for ephemeral / fire-and-forget invocations. Standalone `codemap watch` decouples the watcher from a transport.
- **Embedded intent classification** beyond the thin keyword classifier in `codemap context --for "<intent>"` — deeper routing belongs in the agent host (Cursor / Claude Code / MCP client).
- **No LLM in the box** — embedded intent classification, semantic search over symbol names, embedding-driven recipe routing — the agent host owns this. We supply structure; they supply meaning.
- **No fix engine** — we **read** structure. Mutating code is a different product class (codemod tools own this). Per-row `actions` hints are enough — agents execute. Adjacent to Moat A.
- **No runtime tracing** — V8 traces / production beacons / live execution telemetry are a different product class (live process data, not static analysis). Static coverage ingestion (`codemap ingest-coverage`) is the closest static-side adjacent capability.
- **No JS execution at index time** — config files via `import()` is the only exception; recipe SQL is parsed but never `eval`'d. Plugin layer (tracked at [`plans/c9-plugin-layer.md`](./plans/c9-plugin-layer.md)) must respect this — plugins describe rules in static config, not by running arbitrary code. _Safety floor — protects supply-chain attack surface._
- **No telemetry upload** — codemap never sends usage data anywhere. Local recipe-recency tracking is opt-out and stays in `.codemap/index.db`. _Floor exists to resist accumulation pressure._

---

## Backlog

- [ ] **Local recipe-recency tracking** — new `recipe_recency(recipe_id PK, last_run_at, run_count)` table; reconciler at MCP/HTTP request boundary; rolling 90-day retention; opt-out via `.codemap/config.ts` `recipe_recency: false`. Surfaces in `--recipes-json` so agents rank recently-used recipes first. Local-only — no upload primitive (resists future telemetry-creep PRs). Effort: M.
- [ ] **Advisory unused-type-members recipe** — `type_members` × `imports.specifiers` (SQLite JSON1) join. Output is review-candidate list, NOT safe-to-delete; bundled `.md` warns about indirect-usage false-positive classes codemap doesn't track (indexed access `T['field']`, `keyof T`, type spreads, mapped types). Re-evaluate the overlap with the now-shipped `rename-preview` recipe before picking up. Effort: S.
- [ ] **`history` table** (deferred — revisit-triggered) — temporal queries: "when did symbol X get `@deprecated`?", "coverage trend over last 50 commits", "files that became dead this week". `audit --base <ref>` covers the most-common temporal question (PR-scoped diff) without schema growth, so the table earns its place only when bigger questions emerge. Two shapes (per-commit snapshots ~N × DB size; append-only event log heavier CTE walks); both pay an N-reindexes backfill cost (~30s per reindex). **Revisit triggers:** two consumers ship `jq`-based "audit-runs-over-time" workflows, OR `query_baselines` evolution becomes a recurring agent need.
- [ ] **`codemap audit` verdict + thresholds** (v1.x) — `verdict: "pass" | "warn" | "fail"` driven by an `audit.deltas[<key>].{added_max, action}` field on the config object (`.codemap/config.{ts,js,json}`). Triggers: two consumers ship `jq`-based threshold scripts with similar shapes, OR one consumer asks with a concrete config sketch. Until then, raw deltas + consumer-side `jq` is the CI exit-code idiom. **Likely accelerant:** the Marketplace Action (next item) shipping is the most plausible path to firing the trigger — once `- uses: stainless-code/codemap@v1` is the dominant CI path, real `jq` threshold scripts will surface.
- [ ] **GitHub Marketplace Action — `stainless-code/codemap@v1`** — composite action wrapping `codemap audit --base ${{ github.base_ref }} --ci` (default) + auto-detect package manager (via [`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector)) + opt-in PR-comment writer. Most primitives already shipped (PR #43 SARIF/annotations on `query`, PR #26 `--changed-since`/`--group-by`/`--summary`, PR #30 baselines, PR #52 `audit --base <ref>`, PR #72 boundary-violations). **Two genuine new CLI surfaces** ship alongside: `--format sarif` on `audit` (today only emits `--json`) and the `--ci` aggregate flag on `query` + `audit` (alias for `--format sarif` + non-zero exit + quiet). Action version stream is independent of CLI version (CLI at `0.4.0`; Action publishes at its own `v1.0.0`). Distribution multiplier: Marketplace is the dominant discovery surface for this tool cohort and codemap is currently absent from it. Plan: [`plans/github-marketplace-action.md`](./plans/github-marketplace-action.md). Effort: M.
- [ ] **Repo-structure conversion (codemap itself: flat → monorepo)** — tracked decision, not a backlog item to ship. Default bias: stay flat until a trigger fires (C.9 community plugins ship as separate packages, OR a user asks for `codemap-core` library export, OR a second distro emerges). Full analysis + three options + reference layouts (fallow / oxc / knip / biome / vitest) + revisit triggers in [`plans/lsp-diagnostic-push.md § Repo-structure tradeoffs`](./plans/lsp-diagnostic-push.md#repo-structure-tradeoffs-canonical-home-for-the-monorepo-vs-flat-decision). Don't convert preemptively.
- [ ] **Monorepo / workspace awareness** — discover workspaces from `pnpm-workspace.yaml` / `package.json` and index per-workspace dependency graphs (separate from the codemap-itself repo-structure decision above; this is about indexing user repos)
- [ ] **Cross-agent handoff artifact** — _speculative_; layered prefix/delta JSON written on session-stop, read on session-start. Complementary to indexing rather than core to it; revisit if user demand emerges
- [ ] **Adapter scaffolding** — `codemap create-adapter --name [name]` generates adapter + test + fixture boilerplate; blocked on community adapter registration API (could land with manual registration)
- [ ] **Config loader** — two candidates: (a) [c12](https://unjs.io/packages/c12) — battle-tested (Nuxt/Nitro), adds extends, env overrides, RC files, watching; still executes config via `jiti`. (b) AST-based extraction with `oxc-parser` — faster, no side effects, safer in untrusted repos; can't handle async/dynamic configs, needs `import()` fallback. Current: native `import()` in `config.ts`
- [ ] Optional **GitHub Actions** `workflow_dispatch` — run golden/benchmark against a **public** corpus only (never private app code)
- [ ] **Sass / Less / SCSS:** [Lightning CSS](https://lightningcss.dev/) is CSS-only; preprocessors need a compile step before CSS parsing — see [architecture.md § CSS](./architecture.md#css--css-parserts-lightningcss)
- [ ] **[UnJS](https://unjs.io) adoption** — candidates: [`citty`](https://unjs.io/packages/citty) (CLI builder), [`pathe`](https://unjs.io/packages/pathe) (cross-platform paths), [`consola`](https://unjs.io/packages/consola) (structured logging), [`pkg-types`](https://unjs.io/packages/pkg-types) (typed `package.json`/`tsconfig.json`), [`c12`](https://unjs.io/packages/c12) (config loader — see config loader item above)
