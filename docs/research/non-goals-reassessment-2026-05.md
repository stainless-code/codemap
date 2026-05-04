# Non-goals reassessment — what _this_ codebase actually unlocks (2026-05)

> **Status:** open · **Trigger:** post-C.11 ship; user observation that several non-goals were inherited from when the project was 1/10th its current size and never re-examined as the surface grew.
>
> **Companion docs:** [`research/fallow.md`](./fallow.md) (capability tracker — what to adopt _from fallow_); this file (capability inventory — what _our codebase_ can do that the [`roadmap.md § Non-goals`](../roadmap.md#non-goals-v1) currently forbids).
>
> **Local clone for deep-dives:** [`/Users/sutusebastian/Developer/OSS/fallow`](file:///Users/sutusebastian/Developer/OSS/fallow) — Cargo workspace with `crates/{lsp,mcp,v8-coverage,graph,extract,cli}`, `decisions/` (ADR-style), `editors/{vscode,zed}`, `docs/plugin-authoring.md`. Inspect for patterns we can adapt before each shipped feature.

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

| #    | Capability                                  | What's already in place                                                                                             | What's needed                                                                                                                                     | Effort |
| ---- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1  | **Components calling deprecated symbols**   | `components.hooks_used` + `calls` + `symbols.doc_comment LIKE '%@deprecated%'`                                      | One bundled recipe (`components-touching-deprecated`)                                                                                             | XS     |
| 1.2  | **Exports never imported anywhere**         | `exports` LEFT JOIN `imports` (by `source` resolution)                                                              | One bundled recipe (`unimported-exports`) — sharper than `untested-and-dead` because it doesn't need coverage to be useful                        | XS     |
| 1.3  | **Cyclomatic complexity per symbol**        | `calls.caller_scope` already aggregates per-symbol; AST walker already counts nodes during parse                    | New `complexity REAL` column on `symbols` populated at parse time + recipe (`high-complexity-untested`)                                           | S      |
| 1.4  | **Refactor risk ranking**                   | `dependencies` (fan-in) + `coverage` (test coverage)                                                                | Recipe (`refactor-risk-ranking` — `fan_in × (100 - coverage_pct)`)                                                                                | XS     |
| 1.5  | **Boundary violations (config-driven)**     | `dependencies` table + glob-matching primitives in `validate-engine`                                                | New `--boundaries <config>` flag on `audit` or recipe consuming the config                                                                        | S      |
| 1.6  | **Type members consumed by external files** | `type_members` + `imports.specifiers` (JSON)                                                                        | Recipe (`unused-type-members`) — needs JSON-extraction predicate on specifiers                                                                    | S      |
| 1.7  | **Mermaid / D2 / Graphviz output**          | `dependencies` + `calls` already shape into edges; SARIF / annotations formatters demonstrate the formatter pattern | New `--format mermaid` formatter (sibling of SARIF in `output-formatters.ts`)                                                                     | S      |
| 1.8  | **More MCP resources**                      | Schema, recipes, skill already exposed via `resource-handlers.ts`                                                   | Add `codemap://files/{path}` (file shape — symbols, imports, exports, coverage) and `codemap://symbols/{name}` (LSP-like reads)                   | S      |
| 1.9  | **Recipe usage telemetry**                  | `query_baselines` precedent (user-data table excluded from `dropAll()`)                                             | New `recipe_usage` table + reconciler at MCP / HTTP request boundary; ranks recipes by recent agent use in `--recipes-json`                       | M      |
| 1.10 | **Symbol-rename dry-run preview**           | `calls` (callers) + `symbols.line_start` / `line_end` (locations)                                                   | New `codemap rename <old> <new> --dry-run --format diff` verb — borders on the "no fix engine" non-goal but stays read-only (just shows the diff) | M      |

**Aggregate**: ~10 first-class agent-facing capabilities sitting in unwritten JOINs / unwritten formatters. Same multiplicative effect as C.11's three bundled recipes.

---

## 2. Non-goals worth challenging

These were defensive choices made when the project was small. The codebase has matured past the original constraint.

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

**Verdict:** flip non-goal to **opt-in FTS5 capability**. Ship as `--with-fts` index flag (off by default to keep cold-start sub-100ms; on for projects that want it). Bundled recipe `text-in-deprecated-functions` exemplifies the JOIN.

**Risk:** index size grows with `--with-fts`. Mitigation: opt-in; document the size tax in `architecture.md` § Schema.

### 2.2 ❓ "No visualisation — rendering belongs to consumer"

**Original framing:** "[Visualisation — skyline / ASCII art / animated diagrams; the index emits structured rows, rendering belongs to the consumer.]"

**What's actually true:** the non-goal conflates **rendering** (drawing pixels) with **shaping data into render-ready formats**. We already emit SARIF (a renderer-specific JSON format) — Mermaid / D2 / Graphviz are the same shape (edges + nodes), just different consumers. A `--format mermaid` formatter on `impact` / `dependencies` recipes lets agents include diagrams inline in chat / PR comments without a second tool.

**Verdict:** flip non-goal to **shape-only output formatters**. Codemap stops being hostile to renderers; it doesn't become one. Mermaid first (MCP clients render it natively in chat); D2 / Graphviz follow if demand emerges.

### 2.3 ❓ "No static analysis"

**Original framing:** "Static analysis — dead code, duplication, complexity, architecture-boundary detection, fix actions are a different product class (e.g. fallow, knip, jscpd)".

**What's actually true:** we already ship `deprecated-symbols`, `untested-and-dead` (post-C.11), `barrel-files`, `fan-in`, `fan-out` — those **are** static analysis. The original line was rhetorical (we don't ship a rule engine with severity levels and `// codemap-disable-next-line` comments) but the bullet over-asserted.

The **real** boundary: **no opinionated rule engine + no fix mutation**. Recipes that compute structural properties (complexity, boundary checks, unused exports) are pure SQL on top of the index — exactly the niche we own.

**Verdict:** rewrite the non-goal as "no opinionated rule engine, no fix engine"; promote complexity / boundary / unused-exports to **first-class recipes** (items 1.3 / 1.5 / 1.2 above).

### 2.4 ❓ "No persistent daemon"

**Original framing:** "Persistent daemon process — SQLite supports concurrent readers and our one-shot CLI startup is sub-100ms; revisit only if MCP / HTTP measurements demand it."

**What's actually true:** we **have** a daemon — `codemap watch`, `codemap mcp --watch`, `codemap serve --watch`. The non-goal preserves a constraint that no longer exists. The CLI cold-start argument still applies for one-shot `codemap query` invocations, but the long-running modes are explicitly daemon-shaped.

**Capability unlocked:** caching parsed ASTs in memory between requests would drop incremental reindex from ms to µs. Worth measuring; the data path already exists (we just throw away the AST per request).

**Verdict:** rewrite as "**daemon stays opt-in**; one-shot CLI never requires it." The current `--watch` flag is the right shape; just stop saying we don't have one.

### 2.5 ❓ "No LSP replacement"

**Original framing:** "Replacing LSP or language servers — no rename / go-to-definition / hover types".

**What's actually true:** we have `show <name>` (file:line + signature → "go to definition"), `impact <target>` (callers / callees → "find references"), `watch` (live index → "background analysis"). That's 80% of LSP read-side. We don't have hover types or rename, but we don't need to **be** an LSP — we can ship a **thin LSP shim** that proxies to existing engines (fallow has `crates/lsp/` we can study for the protocol shape).

**Verdict:** rewrite as "no LSP **engine**; LSP **shim** consuming the existing index is in scope." Defer the shim until plugin layer (C.9) lands — entry-point awareness sharpens "find references" accuracy.

---

## 3. True architectural limits — preserve

These aren't defensive prejudices; they're real shape constraints that the SQL-index approach genuinely doesn't fit.

| Limit                             | Why it's real                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sub-100ms cold-start CLI**      | Every `codemap query` / `codemap show` is a one-shot read. Adding a daemon-by-default would break the ergonomics. Daemon stays opt-in (`--watch` flag) per § 2.4.                                                                                                             |
| **No LLM in the box**             | Embedded intent classification, semantic search over symbol names, embedding-driven recipe routing — the agent host owns this. We supply structure; they supply meaning.                                                                                                      |
| **No fix engine**                 | We **read** structure. Mutating code is a different product class (codemod tools own this). Per-row `actions` hints are enough — agents execute. The `rename --dry-run` capability (item 1.10) is borderline; ships only if it stays read-only (diff output, no file writes). |
| **No runtime tracing**            | V8 traces / production beacons — Fallow's paid moat. Static coverage ingestion (just shipped) is the opt-in slice.                                                                                                                                                            |
| **No JS execution at index time** | Config files via `import()` is the only exception; recipe SQL is parsed but never `eval`'d. Plugin layer (C.9) must respect this — plugins describe rules in static config (globs, glob → `is_entry: true` mappings), not by running arbitrary code.                          |

---

## 4. What to inspect in the local fallow clone

`/Users/sutusebastian/Developer/OSS/fallow` (Cargo workspace; ~149 releases as of 2026-04). Areas worth a deep-dive _before_ each shipped feature so we adopt patterns rather than reinvent:

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

| Pick                                                    | Effort | Agent value                          | Why                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------- | ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **(a) FTS5 + Mermaid output** (§ 2.1 + § 2.2 in one PR) | M      | High                                 | Both are non-goals worth flipping, both are ~50–150 LoC each, both compound directly with every existing recipe. One bundled recipe (`text-in-deprecated-functions`) demonstrates the JOIN; one new `--format mermaid` flag on `impact` demonstrates the formatter. Same shape as C.11 plan: minor changeset (FTS5 = new virtual table = SCHEMA bump), bundled recipe. |
| **(b) C.9 Framework plugin layer**                      | XL     | Very High but multiplier-on-existing | Sharpens every shipped recipe (untested-and-dead currently false-positives Next.js page.tsx). Big surface; needs full plan PR per the docs/research/fallow.md note. Defer to (a)+(b) sequence: ship (a) first as a confidence-building "we can flip a non-goal cleanly" move, then plan (b) as the multi-tracer big-surface PR.                                        |
| **(c) Cyclomatic complexity column** (item 1.3)         | S      | Medium                               | Pure data addition; one new column on `symbols`, one bundled recipe (`high-complexity-untested`). Promotes "no static analysis" non-goal flip from rhetoric to concrete capability.                                                                                                                                                                                    |
| **(d) LSP shim** (§ 2.5)                                | L      | Very High agent UX                   | Blocks on (b) for entry-point awareness. Cross-reference fallow `crates/lsp/` heavily during plan.                                                                                                                                                                                                                                                                     |

**Recommended order:** (a) → (c) → (b) → (d).

**Rationale:**

1. (a) is the cheapest non-goal flip; ships in one PR; proves the pattern.
2. (c) reuses (a)'s "new column on `symbols`" muscle; keeps the cadence.
3. (b) is the big-surface multi-tracer PR — by the time we get here, FTS5 + Mermaid + complexity have shown the "compositional capability" thesis on real recipes.
4. (d) lands last because LSP shim wants entry-point awareness from (b) to give accurate "find references".

---

## 6. Open questions

- **Daemon-by-default for MCP / HTTP** — even with one-shot CLI preserved, should `mcp` and `serve` default to `--watch` since both are inherently long-running? Reduces "is index stale?" friction agents already complain about.
- **FTS5 opt-in vs default-on** — index size tax is real on big repos. First pass: opt-in via `codemap.config.ts` `fts5: true`. Revisit after measurements on the fallow / external corpus.
- **LSP shim vs new-process LSP server** — shim wraps the existing engines via stdio (cheap, no new transport); standalone LSP server forks a daemon (matches LSP convention, more code). Probably shim first; standalone if VSCode extension demand emerges.
- **Plugin contract scope (C.9)** — entry-point hints only (option (i) per fallow.md § 6) vs arbitrary `dependencies` edges (option (ii)). Bias toward (i) per the existing fallow.md note; revisit during plan PR.
- **`history` table** — would unlock "when did coverage drop?" / "when did symbol X last have a caller?". Schema-shape question: per-commit snapshots (large) vs append-only event log (small but harder to query). Defer until a recipe demands it.

---

## 7. Cross-references

- [`roadmap.md § Non-goals (v1)`](../roadmap.md#non-goals-v1) — current non-goals list (this doc proposes amendments)
- [`roadmap.md § Backlog`](../roadmap.md#backlog) — backlog items this doc reorders
- [`research/fallow.md`](./fallow.md) — capability tracker for adopt-from-fallow items (different lens from this doc)
- [`research/competitive-scan-2026-04.md`](./competitive-scan-2026-04.md) — original three-tool scan (closed; this doc supersedes its non-goals shaping)
- [`docs/why-codemap.md § What Codemap is not`](../why-codemap.md#what-codemap-is-not) — consumer-facing framing of non-goals (must be updated in lockstep when § 2 items ship)
- Local fallow clone — `/Users/sutusebastian/Developer/OSS/fallow` (see § 4 for what to inspect when)
