# Non-goals reassessment — what _this_ codebase actually unlocks (2026-05)

> **Status:** open · **Trigger:** post-C.11 ship; user observation that several non-goals were inherited from when the project was 1/10th its current size and never re-examined as the surface grew.
>
> **Lens:** **Prescriptive** — proposes specific non-goal flips, ship sequence, open questions. Every concrete capability claim is grounded in a file path + a `codemap query` / `rg` invocation a reviewer can re-run; canonical references live in [`architecture.md § Schema`](../architecture.md#schema), [`src/db.ts`](../../src/db.ts), [`src/adapters/builtin.ts`](../../src/adapters/builtin.ts), and [`src/application/audit-engine.ts`](../../src/application/audit-engine.ts) (`V1_DELTAS`).
>
> **Companion docs:** [`research/fallow.md`](./fallow.md) (capability tracker — what to adopt _from fallow_); [`research/competitive-scan-2026-04.md`](./competitive-scan-2026-04.md) (closed; original three-tool scan).
>
> **Source for deep-dives:** [fallow upstream](https://github.com/fallow-rs/fallow) — Cargo workspace with `crates/{lsp,mcp,v8-coverage,graph,extract,cli}`, `decisions/` (ADR-style), `editors/{vscode,zed}`, `docs/plugin-authoring.md`. Inspect for patterns we can adapt before each shipped feature.
>
> **Errata note (2026-05):** Three claims in v1 of this doc were softened or corrected after cross-checking against the codebase (item 1.3 effort + scope, § 2.3 framing of `fan-in.sql`, plus a citation gap on closed-dead-subgraph evidence). See § 8 for the full diff and the process lesson it surfaced.

---

## 0. Reframing question

The original [`Non-goals (v1)`](../roadmap.md#non-goals-v1) list was a **product-shape** constraint: "stay a SQL-index primitive, don't become a verdict tool, don't render visualisations, don't ship an LSP." That shape held when codemap had ~5 recipes, a single transport, and no engine reuse.

It no longer holds. The current surface ships:

- 15+ bundled recipes (incl. `untested-and-dead`, `files-by-coverage`, `worst-covered-exports` from C.11) plus project-local recipe loader
- 12+ tables — `symbols`, `imports`, `exports`, `components`, `dependencies`, `markers`, `type_members`, `calls`, `css_*`, `coverage`, `query_baselines`, `meta`
- Three transport-agnostic engines (CLI, MCP, HTTP) all dispatching the same pure handlers
- Watch mode (chokidar) + MCP `--watch` + HTTP `--watch` — a daemon by every meaningful definition
- Coverage (Istanbul + LCOV), audit (drift + ref-baseline), impact (graph walker), validate, show / snippet
- SARIF + GitHub annotations output formatters
- Self-healing `<state-dir>` reconcilers + Zod-as-config schema
- Recipe `actions` template (per-row agent hints)

The right framing now: **what does the SQL-index-with-three-transports + worker-pool + watcher actually unlock that no other tool in the ecosystem does?** Re-list non-goals against capability, not against the original "stay narrow" prejudice.

---

## 1. Capability inventory — already shippable today

The data and pipeline exist. Each row needs only a recipe / formatter / verb to expose. Estimated effort assumes one tracer-bullet PR each.

| #    | Capability                                  | What's already in place                                                                                                                           | What's needed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Effort |
| ---- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1.1  | **Components calling deprecated symbols**   | `components.hooks_used` + `calls` + `symbols.doc_comment LIKE '%@deprecated%'`                                                                    | One bundled recipe (`components-touching-deprecated`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | XS     |
| 1.2  | **Exports never imported anywhere**         | `exports` LEFT JOIN `imports` (by `source` resolution); `exports.re_export_source` column exists for re-export chain handling                     | Recipe (`unimported-exports`) — re-export chains need a JOIN through `re_export_source` to avoid false positives on barrel-only exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | S      |
| 1.3  | **Cyclomatic complexity per symbol**        | `calls.caller_scope` already aggregates per-symbol. (Earlier draft claimed AST node-counting was already in place; corrected per § 8 — it isn't.) | Extend the AST walker in `src/parser.ts` to count branching nodes per symbol; add `complexity REAL` column on `symbols`; ship `high-complexity-untested` recipe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | M      |
| 1.4  | **Refactor risk ranking**                   | `dependencies` (fan-in) + `coverage` (test coverage)                                                                                              | Recipe (`refactor-risk-ranking` — `fan_in × (100 - coverage_pct)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | XS     |
| 1.5  | **Boundary violations (config-driven)**     | `dependencies` table + glob-matching primitives in `validate-engine`                                                                              | New `--boundaries <config>` flag on `audit` or recipe consuming the config                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | S      |
| 1.6  | **Type members consumed by external files** | `type_members` + `imports.specifiers` (JSON)                                                                                                      | Recipe (`unused-type-members`) — needs JSON-extraction predicate on specifiers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | S      |
| 1.7  | **Mermaid / D2 / Graphviz output**          | `dependencies` + `calls` already shape into edges; SARIF / annotations formatters demonstrate the formatter pattern                               | New `--format mermaid` formatter (sibling of SARIF in `output-formatters.ts`) **with bounded-input contract**: input must come from `impact` engine, a `LIMIT N`-shipped recipe (e.g. `fan-in`, `fan-out`), or ad-hoc SQL with explicit `LIMIT ≤ 50`. Unbounded inputs error with a scope-suggestion message naming the recipe + edge count + `LIMIT`/`--via`/`WHERE` knobs. Auto-truncation is out of scope — silent subset selection would be a **verdict-shaped affordance** masquerading as an output mode (violates moat A). Hairballed Mermaid renders as garbage in chat clients (MCP / Cursor / Slack); a clear error pointing at how to scope is the better DX. | S      |
| 1.8  | **More MCP resources**                      | Schema, recipes, skill already exposed via `resource-handlers.ts`                                                                                 | Add `codemap://files/{path}` (file shape — symbols, imports, exports, coverage) and `codemap://symbols/{name}` (LSP-like reads)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | S      |
| 1.9  | **Recipe usage telemetry**                  | `query_baselines` precedent (user-data table excluded from `dropAll()`)                                                                           | New `recipe_usage` table + reconciler at MCP / HTTP request boundary; ranks recipes by recent agent use in `--recipes-json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | M      |
| 1.10 | **Symbol-rename dry-run preview**           | `calls` (callers) + `symbols.line_start` / `line_end` (locations)                                                                                 | Bundled recipe `rename-preview.sql` with **parameter substitution** (new infra: `?`-placeholder binding via `db.ts`'s prepared-statement pattern); `--format diff` output mode (sibling of `--format mermaid` per item 1.7) converts rows to unified diff. **No new verb** — `query --recipe rename-preview --params old=foo,new=bar --format diff` is the surface. Moat-A-aligned (SQL is the API; rename's implicit choices — visibility filter, type-only re-exports, test files, aliases — live in reviewable recipe SQL, not argv). Effort drops M → S                                                                                                              | M      |

**Aggregate**: ~10 first-class agent-facing capabilities sitting in unwritten JOINs / unwritten formatters. Same multiplicative effect as C.11's three bundled recipes.

**Cross-cutting infrastructure unlocked by item 1.10**: parametrised recipes (`--params key=value` with `?`-placeholder binding) are net-new infrastructure but pay for themselves on the first downstream use. Already-visible follow-ons: `delete-symbol-preview`, `extract-function-preview`, `inline-symbol-preview` (recipe-shaped refactoring previews — all moat-A-aligned, all gated on the same prepared-statement plumbing). Parametrising existing static recipes (`untested-and-dead --params min_coverage=80` instead of hardcoded `< 80`) is also a cleanup opportunity that the same plumbing enables.

---

## 2. Non-goals worth challenging

These were defensive choices made when the project was small. The codebase has matured past the original constraint.

**Reading note (post-§ 3 moat reframe):** each flip below relates to the moats (§ 3 rows A and B) differently:

- **§ 2.1, § 2.3** — extend the substrate **moat B** protects (richer extraction, more first-class recipes inside the SQL-as-API thesis).
- **§ 2.2** — aligns with **moat A** (`--format mermaid` is an output mode, never a verdict-shaped primitive).
- **§ 2.4, § 2.5** — moat-orthogonal **transport / config-UX** questions; flipping doesn't touch either moat because the substrate isn't moved, just re-exposed.

The `Verdict` rows below tie each flip back to the moat it touches; `❓` is preserved as the open-flip marker.

### 2.1 ❓ "No FTS5 / use ripgrep for full-text"

**Original framing:** [`roadmap.md § Non-goals`](../roadmap.md#non-goals-v1) — "Full-text search across all file bodies — use ripgrep / IDE / opt-in FTS5".

**What's actually true:** SQLite has FTS5 built in. We already ship a `WITHOUT ROWID` table (`coverage`); a `source_fts` virtual table indexed at parse time is structurally identical. ripgrep's "loss" is **JOIN composition** — once content is an FTS table, you can write:

```sql
-- "TODO comments inside @deprecated functions in files with <50% coverage"
SELECT m.file_path, m.line_number, m.content
FROM markers m
JOIN symbols s ON s.file_path = m.file_path
              AND m.line_number BETWEEN s.line_start AND s.line_end
LEFT JOIN coverage c ON c.file_path = s.file_path AND c.name = s.name AND c.line_start = s.line_start
WHERE s.doc_comment LIKE '%@deprecated%'
  AND COALESCE(c.coverage_pct, 0) < 50
  AND m.kind = 'TODO';
```

ripgrep can't compose with `symbols` / `coverage` / `markers` in one shot — it can produce a list of file paths the agent then has to JOIN in JS. Same anti-pattern C.11 fixed for coverage.

**Verdict:** flip non-goal to **opt-in FTS5 capability**. Per [§ 6 Q2 (resolved 2026-05)](#resolved-2026-05): toggle via either `codemap.config.ts` `fts5: true` OR `--with-fts` CLI flag at index time. **Default OFF** — preserves `.codemap/index.db` size for non-users (FTS5 grows the DB ~30–50% on text-heavy projects). Cold-start is **unaffected** (FTS5 is index-time cost only; one-shot CLI reads the existing DB and the virtual table doesn't slow startup) — earlier "off to keep cold-start sub-100ms" framing was wrong. Bundled recipe `text-in-deprecated-functions` exemplifies the JOIN.

**Risk:** index size grows with `--with-fts`. Mitigation: opt-in; document the size tax in `architecture.md` § Schema.

### 2.2 ❓ "No visualisation — rendering belongs to consumer"

**Original framing:** "[Visualisation — skyline / ASCII art / animated diagrams; the index emits structured rows, rendering belongs to the consumer.]"

**What's actually true:** the non-goal conflates **rendering** (drawing pixels) with **shaping data into render-ready formats**. We already emit SARIF (a renderer-specific JSON format) — Mermaid / D2 / Graphviz are the same shape (edges + nodes), just different consumers. A `--format mermaid` formatter on `impact` / `dependencies` recipes lets agents include diagrams inline in chat / PR comments without a second tool.

**Verdict:** flip non-goal to **shape-only output formatters**. Codemap stops being hostile to renderers; it doesn't become one. Mermaid first (MCP clients render it natively in chat); D2 / Graphviz follow if demand emerges.

### 2.3 ❓ "No static analysis"

**Original framing:** "Static analysis — dead code, duplication, complexity, architecture-boundary detection, fix actions are a different product class (e.g. fallow, knip, jscpd)".

**What's actually true:** we already ship `deprecated-symbols`, `untested-and-dead` (post-C.11), `barrel-files`, `worst-covered-exports`, `visibility-tags` — those **are** static analysis. The original line was rhetorical (we don't ship a rule engine with severity levels and `// codemap-disable-next-line` comments) but the bullet over-asserted.

**Caveat (caught by triangulation):** `fan-in` and `fan-out` are **hotspot rankers**, not dead-code detectors — `fan-in.sql` literally `ORDER BY fan_in DESC LIMIT 15` ([source](../../templates/recipes/fan-in.sql)). They're structural-property recipes (legitimate static analysis), but they don't cover the closed-dead-subgraph case ([`research/fallow.md` § 0](./fallow.md#0-fresh-evidence--what-a-hands-on-graph-audit-surfaced) documents the 8-file widget pack where every file had non-zero `dependencies` fan-in via self-import; the fan-in recipe missed the entire pack). That gap is a multi-axis case the C.9 framework plugin layer addresses, not the "no static analysis" non-goal.

The **real** boundary lives in **§ 3 moat A** ("verdicts are an OUTPUT mode, never a primitive") + **§ 3 ergonomic "No fix engine"** row. § 2.3 doesn't restate that boundary — it names the static-analysis _category_ as in-scope; § 3 names the _shape_ it must take.

**Verdict:** static analysis is in scope as **predicate-as-API recipes** (per moat A). Promote complexity / boundary / unused-exports to **first-class recipes** (items 1.3 / 1.5 / 1.2 above). The previously-stated "no opinionated rule engine + no fix engine" wording now lives canonically in § 3 (moat A + ergonomic row); cross-reference, don't restate.

### 2.4 ❓ "No persistent daemon"

**Original framing:** "Persistent daemon process — SQLite supports concurrent readers and our one-shot CLI startup is sub-100ms; revisit only if MCP / HTTP measurements demand it."

**What's actually true:** we **have** a daemon — `codemap watch`, `codemap mcp --watch`, `codemap serve --watch`. The non-goal preserves a constraint that no longer exists. The CLI cold-start argument still applies for one-shot `codemap query` invocations (preserved as a § 3 ergonomic floor), but the long-running modes are explicitly daemon-shaped.

**Moat relation:** orthogonal — daemon is a transport / process-model concern; neither moat A (predicate-as-API) nor moat B (extracted structure) is touched by flipping it. This is why § 2.4 stays a flip but doesn't gain new flip-shape arguments from the moat reframe.

**Capability unlocked:** caching parsed ASTs in memory between requests would drop incremental reindex from ms to µs. Worth measuring; the data path already exists (we just throw away the AST per request). Lives downstream of the § 6 Q1 daemon-default decision.

**Verdict:** rewrite as "**daemon stays opt-in for one-shot CLI; default-ON for inherently-long-running modes (`mcp` / `serve`)**." Per [§ 6 Q1 (resolved 2026-05)](#resolved-2026-05): both default `--watch` ON with `--no-watch` opt-out; one-shot CLI defaults preserved.

### 2.5 ❓ "No LSP replacement"

**Original framing:** "Replacing LSP or language servers — no rename / go-to-definition / hover types".

**What's actually true:** we have `show <name>` (file:line + signature → "go to definition"), `impact <target>` (callers / callees → "find references"), `watch` (live index → "background analysis") — LSP read-side capabilities **already in shipped engines** (`application/show-engine.ts`, `application/impact-engine.ts`, watch-mode chokidar). An LSP shim wraps them via stdio without re-extracting structure; fallow has `crates/lsp/` to study for the protocol shape.

**Moat relation:** transport-only. Shim wraps existing engines; doesn't move substrate (moat B) or pre-bake verdicts (moat A). The reason _not_ to ship an LSP **engine** is that an engine would re-extract structure inside the protocol layer — duplicating the substrate moat B already owns. The shim approach explicitly respects this.

**Verdict:** no LSP **engine** (would duplicate moat B substrate); LSP **shim** consuming existing engines is in scope. Defer the shim until plugin layer (C.9) impl lands — entry-point awareness sharpens "find references" accuracy.

---

## 3. True architectural limits — preserve

Two layers. **Moat** rows are load-bearing under the "equal / surpass fallow on agent-facing capability while keeping the SQL-index thesis" mission — eroding either of them turns codemap into "fallow with extra steps." **Ergonomic / safety** rows are real shape constraints but not differentiators; they're floors, not moats.

### Moat (load-bearing — every PR reviewer should defend these)

| Limit                                 | Why it's the moat                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. SQL is the API**                 | Every capability is a recipe (saved query) or a primitive recipes can compose — never a pre-baked verdict. Fallow ships verdict-shaped verbs (`fallow dead-code`, `fallow audit`) per [`fallow.md § 5`](./fallow.md#5-where-codemap-is-already-ahead-fallow-could-learn-back); codemap exposes the **predicate**, not the verdict. The moment a CLI verb returns `pass`/`fail` _without_ a recipe form behind it, the moat erodes. **Verdicts are an OUTPUT mode** (e.g. `--format sarif`, `audit --base <ref>` deltas), never a primitive. Reviewer test for any new verb: "is this also expressible as `query --recipe <id>`?" |
| **B. Extracted structure ≥ verdicts** | Schema breadth is what _equals/surpasses_ fallow on agent-facing capability. CSS (`css_variables` / `css_classes` / `css_keyframes`), `markers`, `type_members`, `calls.caller_scope`, `components.hooks_used` — fallow has none of these per [`fallow.md § 5`](./fallow.md#5-where-codemap-is-already-ahead-fallow-could-learn-back). Every § 1 capability depends on this substrate. Slimming the schema for theoretical perf / simplicity is a regression unless the column is empirically unread. Reviewer test for any "drop column X" PR: "what recipe (bundled or hypothetical) does this kill?"                          |

### Ergonomic / safety preferences (real but not differentiators)

| Limit                             | Why it's real                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sub-100ms cold-start CLI**      | Every `codemap query` / `codemap show` is a one-shot read. Adding a daemon-by-default would break the ergonomics. Daemon stays opt-in (`--watch` flag) per § 2.4. _Floor, not moat — fallow is also fast._                                                                                                                                            |
| **No LLM in the box**             | Embedded intent classification, semantic search over symbol names, embedding-driven recipe routing — the agent host owns this. We supply structure; they supply meaning. _Convergent with fallow — not a differentiator._                                                                                                                             |
| **No fix engine**                 | We **read** structure. Mutating code is a different product class (codemod tools own this). Per-row `actions` hints are enough — agents execute. The `rename --dry-run` capability (item 1.10) is borderline; ships only if it stays read-only (diff output, no file writes). _Adjacent to moat A — fix engines tend to dictate verdict-shaped APIs._ |
| **No runtime tracing**            | V8 traces / production beacons — fallow's paid moat. Static coverage ingestion (shipped in C.11) is the opt-in slice. _The single rivalrous limit — fallow's paid product lives here._                                                                                                                                                                |
| **No JS execution at index time** | Config files via `import()` is the only exception; recipe SQL is parsed but never `eval`'d. Plugin layer (C.9) must respect this — plugins describe rules in static config (globs, glob → `is_entry: true` mappings), not by running arbitrary code. _Safety floor — protects supply-chain attack surface; both tools converge here._                 |

---

## 4. What to inspect in the fallow source tree

Fallow is a Cargo workspace ([upstream](https://github.com/fallow-rs/fallow); ~149 releases as of 2026-04). Areas worth a deep-dive _before_ each shipped feature so we adopt patterns rather than reinvent:

| Fallow surface                     | Codemap relevance                                                                                                        | When to inspect                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `crates/lsp/`                      | LSP shim (§ 2.5) — protocol shape, message handlers, capability negotiation                                              | Before § 2.5 ships                                         |
| `crates/mcp/`                      | Cross-check our `mcp-server.ts` tool taxonomy against fallow's; spot tools we're missing                                 | Before adding any MCP tool                                 |
| `crates/v8-coverage/`              | Out of scope for us (paid moat) but instructive for understanding the line between static (us) and runtime (them)        | Reference only                                             |
| `crates/graph/`                    | Graph algorithms (cycle detection, fan-in/fan-out scoring); compare against our recursive CTEs                           | Before complexity recipe (item 1.3)                        |
| `crates/extract/`                  | AST extraction patterns; cross-check our `parser.ts` against their oxc usage                                             | Before any new `symbols` column                            |
| `decisions/`                       | ADR-style decision records (`001-no-typescript-compiler.md` etc.) — adopt the pattern for our own decisions              | One-off: shape codemap's plan files toward this convention |
| `editors/vscode/` + `editors/zed/` | Reference for codemap's eventual VS Code extension (orthogonal to LSP shim — extension can use either)                   | When demand exists                                         |
| `docs/plugin-authoring.md`         | Plugin authoring guide — model for our C.9 plugin contract                                                               | Before C.9 plan                                            |
| `docs/positioning.md`              | How fallow positions vs. linters / type checkers — mirror for codemap's vs. ripgrep / LSP framing                        | Before any positioning doc revision                        |
| `plugin-schema.json`               | JSON schema for plugins — direct precedent for C.9 contract                                                              | Before C.9 plan                                            |
| `BENCHMARKS.md` + `benchmarks/`    | Benchmark methodology + real numbers — cross-check our `query-output-benchmark` shape                                    | Before any perf-sensitive recipe                           |
| `action.yml` + `action/`           | GitHub Action wrapper — precedent for [`roadmap.md` Backlog](../roadmap.md#backlog) "GitHub Actions `workflow_dispatch`" | Before that backlog item lands                             |
| `_typos.toml` + `deny.toml`        | Repo-hygiene config — adopt where it strengthens our pre-commit / CI                                                     | Background                                                 |

**Discipline:** every PR that ships a feature with a fallow precedent cites the fallow source path it took inspiration from in the changeset / plan. Mirrors the existing [`research/fallow.md` Status snapshot](./fallow.md#status-snapshot-as-of-2026-05-03) cite-the-PR habit.

---

## 5. Recommended next-pick under the new framing

| Pick                                                    | Effort | Agent value                          | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **(a) FTS5 + Mermaid output** (§ 2.1 + § 2.2 in one PR) | M      | High                                 | Both are non-goals worth flipping, both are ~50–150 LoC each, both compound directly with every existing recipe. One bundled recipe (`text-in-deprecated-functions`) demonstrates the JOIN; one new `--format mermaid` flag on `impact` demonstrates the formatter. Same shape as C.11 plan: minor changeset (FTS5 = new virtual table = SCHEMA bump), bundled recipe.                                                                                                               |
| **(b) C.9 Framework plugin layer**                      | XL     | Very High but multiplier-on-existing | Sharpens every shipped recipe (untested-and-dead currently false-positives Next.js page.tsx). Big surface; **plan PR opens at T+0 in parallel with (a) shipping** — pre-locked decisions (entry-point hints only per Grill Q4; no JS exec at index time per § 3 ergonomic limits) cut its cold-start. Plan iterates during (a)+(c) shipping; impl unblocks when its slot arrives. Avoids the deferral trap where XL items become "next quarter" while the noisy-substrate compounds. |
| **(c) Cyclomatic complexity column** (item 1.3)         | M      | Medium                               | One new column on `symbols`, one bundled recipe (`high-complexity-untested`). Effort is **M** (matches § 1.3 / § 8 errata) because branching-node counting requires extending the AST walker in `src/parser.ts` — node-counting isn't already in place. Promotes "no static analysis" non-goal flip from rhetoric to concrete capability.                                                                                                                                            |
| **(d) LSP shim** (§ 2.5)                                | L      | Very High agent UX                   | Blocks on (b) impl for entry-point awareness. Cross-reference fallow `crates/lsp/` heavily during plan.                                                                                                                                                                                                                                                                                                                                                                              |

**Recommended order (shipping cadence):** (a) → (c) → (b) impl → (d). **Plan track (parallel):** (b) plan PR opens at T+0.

| T              | Track 1 — shipping cadence                                                                 | Track 2 — (b) plan PR                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **T+0**        | —                                                                                          | Open `docs/plans/c9-plugin-layer.md` (skeleton; pre-locked: entry-point hints only, static config, no JS exec) |
| **T+0 → +1w**  | Ship **(a)** FTS5 + Mermaid (one PR; schema bump + formatter)                              | Plan iterates — contract shape, plugin discovery, reachability sweep algorithm, schema deltas                  |
| **T+1w → +2w** | Ship **(c)** complexity column (1 column + 1 recipe; reuses (a)'s schema-bump muscle)      | Plan converges; ready for impl review                                                                          |
| **T+2w → +5w** | Ship **(b) impl** — merged with plan                                                       | done                                                                                                           |
| **T+5w → +7w** | Ship **(d)** LSP shim (consumes (b)'s entry-point awareness; per fallow `crates/lsp/` map) | —                                                                                                              |

**Rationale:**

1. (a) is the cheapest non-goal flip; ships in one PR; the §3 moat rewrite already paid the "we can flip a non-goal cleanly" confidence move so (a) doesn't need to re-pay it.
2. (c) reuses (a)'s "new column on `symbols`" muscle; keeps the cadence.
3. (b) is the big-surface multi-tracer PR — by the time impl starts, FTS5 + Mermaid + complexity have shown the "compositional capability" thesis on real recipes, and the plan has converged. Plan-in-parallel is the structural commitment that resists the deferral trap (every recipe layered on the noisy `dependencies` substrate inherits `untested-and-dead`'s Next.js-page false-positive class until (b) lands).
4. (d) lands last because LSP shim wants entry-point awareness from (b) to give accurate "find references".

**Cost if (b) is abandoned mid-plan:** the plan PR closes as `Status: Rejected (YYYY-MM-DD) — <reason>` per [`docs/README.md` Rule 8](../README.md). Design surface captured either way.

---

## 6. Open questions

### Resolved (2026-05)

- ✅ **Q1 — Daemon-by-default for `mcp` / `serve`** — **default `--watch` ON for both**; opt-out via `--no-watch` / `CODEMAP_WATCH=0`. One-shot CLI defaults preserved (still no watcher on `query` / `show` / `snippet`). Both modes are inherently long-running; stale-index friction is the #1 agent UX complaint per [`fallow.md § 6`](./fallow.md#6-open-questions); chokidar startup validated tiny on Bun + Node by the [PR #46 6-watcher audit](https://github.com/stainless-code/codemap/pull/46). **Downstream:** AST in-memory caching between requests (per § 2.4) — would drop incremental reindex ms → µs; data path already exists. Worth measuring once defaults stabilise. Flip is a small follow-up PR (flag default + test + patch changeset + agent rule update per [`docs/README.md` Rule 10](../README.md)).
- ✅ **Q3 — LSP shape** — **thin shim, no engine**; consume existing `application/show-engine.ts` + `application/impact-engine.ts` + watch-mode via stdio. Per § 2.5 reframe — building an LSP _engine_ would re-extract structure inside the protocol layer, duplicating moat B substrate. Standalone LSP server deferred to "if VSCode-extension demand emerges" (no measurement today supports it).
- ✅ **Q4 — C.9 plugin contract scope** — **entry-point hints only for v1** (option (i) per [`fallow.md § 6`](./fallow.md#6-open-questions)). Plugins contribute `glob → is_entry: true` annotations on `files`; reachability sweep over `dependencies` from entry points closes the closed-dead-subgraph case (8-file widget pack via [`fallow.md § 0`](./fallow.md#0-fresh-evidence--what-a-hands-on-graph-audit-surfaced)). Arbitrary `dependencies` edge injection deferred to v2 if a real recipe demands it. Static config only — respects § 3 ergonomic "no JS exec at index time" floor. Pre-locked into the (b) plan PR per § 5.

- ✅ **Q2 — FTS5 opt-in vs default-on** — **opt-in via either `codemap.config.ts` `fts5: true` OR `--with-fts` CLI flag at index time; default OFF.** Both surfaces because config-only forces CI / ephemeral-index workflows to commit `fts5: true`; CLI-only forces every long-term user to remember the flag on `--full`. Default OFF respects backwards-compat: existing users wouldn't see `.codemap/index.db` grow ~30–50% silently on the next `--full`. Cold-start is unaffected either way (FTS5 is index-time cost only) — the earlier "default OFF to keep cold-start sub-100ms" framing was a wrong reason. **Re-evaluate default** in v2 once external-corpus size measurements (`bun run benchmark:query` shape) land. Default-ON is reserved for capabilities without disk-size tax (Mermaid output, parametrised recipes, complexity column).

- ✅ **Q5 — `history` table** — **deferred (2026-05)**. Cost / use-case / shape analysis below; revisit triggers pinned for the next reviewer.

  **What it would do.** Today's index is a **point-in-time snapshot** — `symbols`, `dependencies`, `coverage` describe "what the code looks like _now_." A `history` table adds a **temporal dimension**: queries like "when did symbol X get `@deprecated`?", "show coverage trend over the last 50 commits", "files that became dead this week" become expressible.

  **What `audit --base <ref>` already covers (and what it doesn't).** The shipped `codemap audit --base origin/main` does a **two-snapshot pairwise diff** — current branch vs one ref (cached worktree+reindex; sub-100ms second run). That answers "what changed between A and B." It does **not** answer "how did it evolve over commits 1..N" — that's the longitudinal gap a `history` table would fill. The pairwise primitive serves the most-common temporal question (PR-scoped delta) without any schema growth.

  **Two shapes (if it ever ships).**

  | Shape                     | Storage                                                                      | Query cost                                                                | Per-commit overhead                   |
  | ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
  | **Per-commit snapshots**  | ~N × current DB size (linear in retention; e.g. 500 commits × 50 MB ≈ 25 GB) | Trivial — `JOIN ON commit_sha`                                            | Full snapshot insert                  |
  | **Append-only event log** | Deltas only (~1–5% per commit; 500 commits ≈ 5–25 MB extra)                  | Heavy — recursive CTEs walking event log to reconstruct state at commit X | Diff-against-previous + insert deltas |

  Both pay an **N-reindexes backfill cost** to populate history for existing commits (worktree-checkout each; ~30s per reindex; 500 commits ≈ 4 hours first-run). Backfill is the deal-breaker today.

  **Architecture impact summary.** Schema bump (minor per pre-v1 changesets lesson); `db.ts` + indexer hooks for emitting history events / snapshots; retention policy (`history.max_commits` config); deepens git integration (`getCurrentCommit()` per pass + `audit --base`-style worktree pipeline reused).

  **Why defer.** (1) No bundled recipe wants history today — adding the table = schema bloat without a paying use case (anti-bloat meta-rule per [`docs-governance` skill](../../.agents/skills/docs-governance/SKILL.md)). (2) `audit --base <ref>` already covers the most-common temporal question. (3) Backfill cost is prohibitive without a clear win. (4) Snapshots-vs-event-log is wasted analysis without empirical access-pattern data.

  **Revisit triggers.** Two consumers ship `jq`-based "audit runs over time" workflows that genuinely want persistence (mirrors B.5 verdict-threshold deferral pattern — wait for **two** asks, not one), OR `query_baselines` evolution queries become a recurring agent need.

---

## 7. Cross-references

- [`architecture.md § Schema`](../architecture.md#schema) — canonical schema reference; the prescriptive items in § 1 are layered on top of these tables.
- [`roadmap.md § Non-goals (v1)`](../roadmap.md#non-goals-v1) — current non-goals list (this doc proposes amendments)
- [`roadmap.md § Backlog`](../roadmap.md#backlog) — backlog items this doc reorders
- [`research/fallow.md`](./fallow.md) — capability tracker for adopt-from-fallow items (different lens from this doc)
- [`research/competitive-scan-2026-04.md`](./competitive-scan-2026-04.md) — original three-tool scan (closed; this doc supersedes its non-goals shaping)
- [`docs/why-codemap.md § What Codemap is not`](../why-codemap.md#what-codemap-is-not) — consumer-facing framing of non-goals (must be updated in lockstep when § 2 items ship)
- [fallow upstream](https://github.com/fallow-rs/fallow) — see § 4 for what to inspect when

---

## 8. Triangulation errata (2026-05)

v1 of this doc was reasoned-from-substrate without enough pinning to actual file:line / `codemap query` references. A peer-model review (`composer-2-fast`) cross-checked every concrete claim against `db.ts`, `builtin.ts`, `audit-engine.ts`, `--recipes-json`, and `templates/recipes/*.sql` — caught three errors. Corrections applied below; documenting them here so future reviewers can see the diff between v1 and v2.

| Section   | Original claim                                                                                                                 | Corrected claim                                                                                                                                                                                                                                                                                                                                                                        | Evidence (codebase = source of truth)                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **§ 1.2** | "Exports never imported anywhere — one recipe; XS effort"                                                                      | Same recipe; **S** effort because `exports.re_export_source` requires a JOIN through re-export chains to avoid false positives on barrel-only exports                                                                                                                                                                                                                                  | `db.ts:69` `re_export_source` column on `exports` table              |
| **§ 1.3** | "AST node count from parser already in place" + "S effort"                                                                     | Node-counting is **not** in place; needs an extension to the AST walker in `src/parser.ts`. **M** effort.                                                                                                                                                                                                                                                                              | `rg 'complexity\|node_count\|nodeCount' src/` returns zero matches   |
| **§ 2.3** | "We already ship `deprecated-symbols`, `untested-and-dead`, `barrel-files`, `fan-in`, `fan-out` — those _are_ static analysis" | Same list, but with the caveat that `fan-in` / `fan-out` are **hotspot rankers** (`ORDER BY DESC LIMIT 15`), not orphan / dead-code detectors. They don't cover the closed-dead-subgraph case from [`research/fallow.md` § 0](./fallow.md#0-fresh-evidence--what-a-hands-on-graph-audit-surfaced) — that gap motivates C.9 (framework plugin layer), not the "no static analysis" flip | `templates/recipes/fan-in.sql` shows `ORDER BY fan_in DESC LIMIT 15` |

**Process lesson** (also in [`.agents/lessons.md`](../../.agents/lessons.md)): every prescriptive research note should pin every concrete claim to a file path / `codemap query` / `rg` invocation a reviewer can re-run, and ideally cross-check against a peer model or self-audit before recommending a ship sequence. The triangulation step on this doc caught all three errors before they propagated into a plan PR.
