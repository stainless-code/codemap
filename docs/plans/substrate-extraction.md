# Substrate extraction — maximal AST → SQLite enrichment plan

> **Status:** open · plan iterating in parallel with the broader [`research/codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) write-engine direction.
>
> **Motivator:** Codemap's distinctive value is the SQL-against-structural-index substrate. Per [Moat B](../roadmap.md#moats-load-bearing) — _"Extracted structure ≥ verdicts. Schema breadth is the substrate every recipe layers on."_ — the load-bearing growth axis is **what oxc / Lightning CSS / config loaders give us that the index doesn't yet expose.** Today the schema captures symbols + imports + exports + calls + components + markers + type*members + css*{variables,classes,keyframes} + suppressions. The AST contains roughly 4× more queryable structure that we discard at parse time. This plan enumerates the entire extraction surface — ~13 tiers spanning identifier references, scope graph, binding resolution, JSX, type-system depth, behavioral facts, module-graph topology, CSS rule structure, test-suite metadata, runtime/dev markers, metrics expansion, and ORM/SQL tracking — and sequences them as independent tracer-bullet PRs that compound into a maximal substrate. Once landed, every recipe / write capability discussed in the synthesis doc (and many more) lights up via SQL JOINs alone, with zero engine work.
>
> **Tier:** XL effort (~3-4 months) spread across ~13 sequential tracer-bullet PRs. No single PR is large; the value compounds. Each tier ships as its own vertical slice (parser → schema → migration → recipes → tests → docs) per [`tracer-bullets`](../../.cursor/rules/tracer-bullets.mdc).
>
> **Goal stated by the user:** "extract as much as possible from the AST and enrich the sqlite db tables, that then unlocks the capabilities we are discussing in this topic AND MORE." The "AND MORE" is the explicit invitation to think past the synthesis doc's write-engine focus — tiers 9–13 below land that.

---

## Table of contents

1. [Pre-locked decisions](#pre-locked-decisions)
2. [Open decisions](#open-decisions)
3. [Architecture](#architecture)
4. [The 13 tiers](#the-13-tiers)
5. [Sequencing (DAG)](#sequencing-dag)
6. [Capability matrix — what unlocks post-extraction](#capability-matrix--what-unlocks-post-extraction)
7. [Operational considerations](#operational-considerations)
8. [What's NOT in scope](#whats-not-in-scope)
9. [Lifecycle](#lifecycle)
10. [Primitive sources + internal cross-references](#primitive-sources--internal-cross-references)

---

## Pre-locked decisions

These commit before any PR opens. Questions opened against them must justify against the linked sources.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R.1  | **Single-pass extraction.** All tier extractors run in one oxc walk per file. No multi-pass over the same AST. Visitor-mode extractors register callbacks per node type; the walk is shared. Performance and correctness — one tree-walk per file is the cheapest contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | oxc Visitor API; existing `extractFileData` in `parser.ts`                                                                                                                                                                                                          |
| R.2  | **Additive schema.** All new substrate is new columns on existing tables OR new tables linked via foreign key. Existing recipes don't break. Schema version bumps trigger one-shot reindex on consumer upgrade (per current `SCHEMA_VERSION` pattern).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Existing `SCHEMA_VERSION` reconciliation in `db.ts` + [`architecture.md`](../architecture.md) schema §                                                                                                                                                              |
| R.3  | **Tier-independent extractors.** Each tier's extractor can be enabled / disabled via `.codemap/config.{ts,js,json}` `extraction.<tier>: false`. Default: all on. Lets users opt out of expensive tiers for fast indexing (e.g. monorepos that don't need JSX/CSS facts). Lets the test suite enable one tier at a time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Defensive — keeps the substrate growth path opt-out-friendly per the existing `fts5: true` / `boundaries: …` config patterns                                                                                                                                        |
| R.4  | **Bindings cascade on file change.** Incremental reindex of file X invalidates `references` + `bindings` + `scopes` rows for X; recomputes them. Other files' bindings to symbols defined in X don't auto-invalidate — they're recomputed lazily on the next access OR on full rebuild. Acceptable staleness for the common case (consumer edits implementation; consumers' references still resolve correctly until name change).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | SQLite cascade semantics; `ON DELETE CASCADE` already used pervasively                                                                                                                                                                                              |
| R.5  | **Position convention.** Lines 1-indexed, columns 0-indexed (byte offsets within line). Matches existing `line_number` / `line_start` convention and oxc's native offset format. Mismatched conventions inside one row are a silent foot-gun.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | oxc emits byte offsets; existing `offsetToLine` already converts                                                                                                                                                                                                    |
| R.6  | **Column-precise = identifier-token-precise.** `column_start` / `column_end` are the byte offsets of the actual name / element token, NOT the containing expression's offsets. So `foo()` records `column_start` = position of `foo`, `column_end` = position after `o`, not after `)`. Matches what a rename engine wants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | LSP `Location` convention; same as `tsserver`'s reference response                                                                                                                                                                                                  |
| R.7  | **Recipes own visibility.** New extracted facts are queryable substrate; recipes decide what to surface as findings / fixes / actions. No bare verdicts at extraction time. Same discipline as `audit verdict` defer per [roadmap backlog](../roadmap.md#backlog).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | [Moat A](../roadmap.md#moats-load-bearing) — verdicts are output mode                                                                                                                                                                                               |
| R.8  | **No JS execution at extract time.** oxc parses; we walk; we record. Same floor as today's index. No `eval`, no dynamic resolution, no LLM in the box.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | [Floors "No JS execution at index time"](../roadmap.md#floors-v1-product-shape)                                                                                                                                                                                     |
| R.9  | **No hard size ceiling; soft warn at >5× DB growth.** Empirical measurement on four real fixtures with a minimal `references`-only probe (one of the heaviest single tiers in isolation) showed consistent ~3.6-4.5× DB growth at one tier. Projecting all 13 tiers conservatively: ~5-10× growth. SQLite handles 200-500 MB DBs trivially. Users hitting pain on large monorepos opt out of expensive tiers via R.3 — that's the safety valve, not a global ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Measured 2026-05-14, four fixtures spanning ~900-2,100 files (see § Operational considerations § Index size growth)                                                                                                                                                 |
| R.10 | **Latency budget tied to user-visible operations, not DB size.** Soft warn when full reindex > 30s OR targeted reindex > 500ms. Measured worst-case (one tier, largest fixture ~2,100 files / 28k symbols): full ~1.9s, targeted ~15ms. Both ~10-60× under the user-stated bottleneck threshold (1 min full / sub-second targeted). Full 13-tier projection still well under budget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Measured 2026-05-14 (see § Operational considerations § Reindex performance)                                                                                                                                                                                        |
| R.11 | **Hand-rolled scope walker in the existing oxc visitor.** No library dep. `oxc-parser` explicitly doesn't construct scopes; no NAPI binding for `oxc-semantic` yet. Existing `scopeStack` in `parser.ts` (used for cyclomatic complexity + call-site scope) extends to a full scope graph. Edge cases (TS namespace merge, declaration hoisting, TDZ) handled conservatively — `bindings.resolution_kind = 'ambiguous'` is the escape valve. Reuses single-pass extraction per R.1; no second AST parse.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | oxc-parser's `showSemanticErrors` doc explicitly says "the parser does not construct symbols and scopes"; existing `scopeStack` infrastructure in `parser.ts`                                                                                                       |
| R.12 | **Pre-resolve `bindings` at index time (two-pass).** Pass 1 (per file, in worker): extract refs, scopes, local declarations. Pass 2 (main thread, after all files parsed): walk `references` rows; resolve via same-file scope-walk → `imports` → `exports` → re-export chain; populate `bindings`. Same architecture as today's `resolver.ts` two-pass for `dependencies`. Cost: ~25-50% on top of refs-only reindex (projected worst case ~3-4s full on the largest fixture; well under R.10 budget). Recipes get a single-JOIN `bindings → symbols` instead of recursive-CTE-per-recipe. R.4 cascade extends: single-file reindex deletes that file's `bindings` rows AND any binding referencing symbols in that file.                                                                                                                                                                                                                                                                                                                                                               | Existing `resolver.ts` two-pass pattern; `dependencies` table as precedent                                                                                                                                                                                          |
| R.13 | **`references.is_write` distinguishes reads from writes.** Boolean column populated by parent-node-shape check during the visitor pass (`AssignmentExpression.left`, `UpdateExpression`, `delete`, `AssignmentPattern`, `VariableDeclarator.id` with initializer, `ForOfStatement.left`, `ForInStatement.left`). Compound assignment (`x += 1`) emits TWO `references` rows — one with `is_write = 0` (the read) and one with `is_write = 1` (the write) — at the same `(file_path, line_start, column_start)`. Substrate honesty: recipes that want a single-row-per-position can `SELECT DISTINCT`. Unlocks immutability audits, side-effect detection, cross-file mutation tracking.                                                                                                                                                                                                                                                                                                                                                                                                  | Cost trivial (one column + ~10 lines of visitor logic); recipe-unlock substantial (no other way to express "find writes to X" without external AST walk)                                                                                                            |
| R.14 | **FTS5 stays file-content-only.** New substrate tables (`references`, `jsx_elements`, `function_params`, `decorators`, `test_suites`, …) are NOT indexed via FTS5 by default. Every `name` / identifier column gets a regular B-tree index, which covers exact match + anchored prefix (`LIKE 'use%'` / `GLOB 'use*'`) at O(log N). FTS5 only helps unanchored substring search; the row counts at every tier remain small enough (~10-500k) that an unanchored `LIKE '%foo%'` scan still completes in tens of milliseconds. Cost saved: ~25-90 MB of FTS5 storage per project across all 13 tiers. Per-tier opt-in path: a tier PR can add FTS5 on its own table when a concrete recipe requires unanchored search — schema-additive, no breaking change.                                                                                                                                                                                                                                                                                                                               | Existing `source_fts` keeps its current shape (file-content full-text); empirical row-count + B-tree-index-perf argument; substrate stays lean                                                                                                                      |
| R.15 | **Tier-level opt-out via `.codemap/config` `extraction: { … }`; human-readable feature names; Tier 1 always on; `orm` default-off, others default-on.** Config keys are capability-shaped (`references`, `jsx`, `types`, `behavioral`, `moduleGraph`, `css`, `projectMeta`, `tests`, `runtimeMarkers`, `metrics`, `moduleTopology`, `orm`) — never tier numbers or table names. Sub-tier toggles rejected because internal coupling within a tier (e.g. `bindings` needs `scopes` needs `references`) makes table-level granularity a foot-gun. Tier 1 (position precision on existing tables) is foundation for every downstream tier — no opt-out. `orm` is framework-specific (Prisma/Drizzle/TypeORM); cost-benefit doesn't justify always-on. Schema validated via existing `codemapUserConfigSchema` (`strict()`); unknown keys rejected.                                                                                                                                                                                                                                          | Matches user's mental model (capabilities, not tables); existing config patterns are single-flag-per-feature (`fts5: true`, `boundaries: […]`, `recipeRecency: false`)                                                                                              |
| R.16 | **Every tier bumps `SCHEMA_VERSION`; full rebuild on mismatch; no in-place migrations.** Existing schema-mismatch logic (`dropAll()` + `createTables()` + `createIndexes()`) handles every tier upgrade transparently. User-data tables (`coverage`, `query_baselines`, `recipe_recency`, `boundary_rules`) stay protected via the existing `dropAll()` exclusion list. Empirical worst case across measured fixtures: full rebuild ~2s on a 28k-symbol enterprise app. Reject in-place `ALTER TABLE` migration scripts entirely — they add per-delta authoring + permanent bug surface for zero meaningful UX win given the measured rebuild cost. A future `codemap migrate --in-place` verb can ship if concrete demand emerges; until then the schema-drift-triggers-rebuild pattern is the right level of abstraction for a derivable index.                                                                                                                                                                                                                                        | Empirical rebuild cost (R.10); existing `dropAll()` exclusion list already protects user data; simpler code path; future-proofs against accidental "additive-looking but actually-modifying" tier PRs                                                               |
| R.17 | **Per-tier extractor modules (`src/extractors/<tier>.ts`) with `register(visitor, ctx)` API.** Each tier ships a `TierExtractor` object exporting `{ tierId, register(visitor: VisitorObject, ctx: ExtractContext): void }`. `parser.ts` becomes a thin orchestrator: builds `ExtractContext`, filters `EXTRACTORS` by `cfg.extraction[tierId] !== false`, multiplexes their visitor handlers (~30 lines of merge logic — multiple extractors registering on the same node type get chained), runs one shared `Visitor.visit(program)`, returns the context. **Migration PR ships before Tier 1**: lifts existing handlers (symbols/imports/exports/calls/components/markers/typeMembers) from `extractFileData` into `src/extractors/`, shrinks `parser.ts` from ~970 lines to ~100; golden fixtures stay green. After migration: every tier PR is purely additive (one new file + one entry in `EXTRACTORS`). Honors R.1 (single AST pass), R.3 (tier-independent extractors), R.15 (config-driven enable/disable).                                                                    | Existing `extractFileData` is already 510 lines for 7 extraction categories; 13 tiers would push it past 2k lines without modularisation; `LanguageAdapter` pattern in `src/adapters/builtin.ts` is the in-repo precedent for first-class pluggable extractor units |
| R.18 | **Every tier PR ships ≥1 flagship recipe + golden fixture.** Definition-of-Done for every tier PR: (a) substrate (schema + extractor + extractor tests); (b) **one bundled recipe** under `templates/recipes/<id>.{sql,md}` exercising the new substrate via real JOIN paths; (c) **one golden fixture** under `fixtures/golden/<recipe-id>.json` so the recipe is regression-tested in CI. Flagship recipe designated in the tier's plan section (currently lists 3-7 "Recipes unlocked" candidates — one gets marked "flagship" per tier). Additional candidate recipes bundle in same PR if cheap, or ship as follow-ups at author discretion. Extension recipes (e.g. Tier 5's `calls.{line_start, column_start}` letting `rename-preview` grow a `call_rows` CTE) ship in the same PR as their substrate. Validates substrate at ship time; catches schema-shape mistakes via real query exercise; honors Moat A reverse-test ("if we remove this column, what recipe dies?"). Matches in-repo precedent — 24 bundled recipes today all shipped alongside their substrate addition. | Existing 24-recipe catalog all followed this pattern de-facto; Moat A's reviewer test demands substrate be queryable                                                                                                                                                |

---

## Open decisions

Each gets a "Resolution" subsection below as it crystallises (mirrors `lsp-diagnostic-push.md` pattern). Numbered for stable citation from future plan PRs.

- **Q1 — `references` resolution strategy.** **RESOLVED 2026-05-14 — promoted to [R.11](#pre-locked-decisions).** Hand-rolled scope walker in existing oxc visitor; no library dep; reuses single-pass extraction. Conservative-on-ambiguity (`bindings.resolution_kind = 'ambiguous'`) handles TS edge cases.

- **Q2 — Multi-file binding resolution.** **RESOLVED 2026-05-14 — promoted to [R.12](#pre-locked-decisions).** Pre-resolve at index time (two-pass), same architecture as today's `resolver.ts`. Pays the cost once at index time; recipes get cheap single-JOIN access.

- **Q3 — Type-text stringification fidelity.** Today `symbols.signature` stringifies types via `stringifyTypeNode`. Tier 4 extends to per-param + per-generic + return-type + predicate-target. Same stringification approach? Or shift to a richer normalized form (canonicalize whitespace; sort union members; etc.)? Plan PR for Tier 4 settles.

- **Q4 — JSX element parent linking.** `jsx_elements.parent_element_id` requires either second pass (after the entire tree is parsed) or order-of-emit guarantee (parent visited before children with stable IDs). oxc walks top-down by default; record IDs eagerly and link in a post-emit pass within the same parser invocation.

- **Q5 — Loop / try / scope context tracking.** Walking the AST top-down — how does `async_calls.in_loop` know it's inside a loop? Maintain a context stack (push on enter ForStatement/WhileStatement/etc., pop on exit). Same for `in_try` / `in_async_fn`. Visitor state shape settles in Tier 5 PR.

- **Q6 — Decorator target resolution.** Decorators in source appear BEFORE the symbol they decorate. Resolution requires post-pass linking — record decorator nodes with their position, then link to the following ClassDeclaration / MethodDefinition / PropertyDefinition once visited. Same pattern as Q4.

- **Q7 — JSDoc tag schema.** Free-form `description` text per tag, OR structured per-tag-shape (each `@param` parsed into `name` + `type_text` + `description`)? Bias toward structured — query power is the point. Settle in Tier 5 PR.

- **Q8 — Test-framework detection.** `describe` / `it` / `test` are global functions in test files. Detect by: (a) config glob (`test: ['**/*.test.ts', '**/*.spec.ts']`); (b) file extension match (`.test.`, `.spec.`); (c) import-presence check (`from 'vitest'` / `'@jest/globals'` / `'node:test'`). Bias toward (b) + (c) — file extension as cheap default; import-presence as strong signal.

- **Q9 — Index size budget.** **RESOLVED empirically 2026-05-14 — promoted to [R.9](#pre-locked-decisions).** Four-fixture probe (one tier, references-only). DB grows ~4× at one tier; projected ~5-10× at full 13 tiers. No hard ceiling; per-tier opt-out (R.3) is the safety valve. Full table in § Operational considerations.

- **Q10 — Reindex performance regression.** **RESOLVED empirically 2026-05-14 — promoted to [R.10](#pre-locked-decisions).** Full reindex ~2-2.6× slower at one tier; targeted reindex stays flat (~10-30ms regardless of project size). Largest fixture measured: ~1.9s full / 15ms targeted. Full table in § Operational considerations.

- **Q11 — Per-tier opt-out shape.** **RESOLVED 2026-05-14 — promoted to [R.15](#pre-locked-decisions).** Tier-level opt-out with capability-shaped names; Tier 1 always on; `orm` default-off; others default-on.

- **Q12 — FTS5 integration.** **RESOLVED 2026-05-14 — promoted to [R.14](#pre-locked-decisions).** FTS5 stays file-content-only; new substrate columns get regular B-tree indexes; per-tier opt-in path stays open for concrete recipe demand.

- **Q13 — Worker-thread message shape.** Today `parse-worker.ts` emits one `ParsedFile` message per file. With many tiers, that message becomes large (~10-20KB per file → ~100-200KB). Worker IPC handles this fine; no architectural change needed but plan PR confirms.

- **Q14 — In-place schema migration.** **RESOLVED 2026-05-14 — promoted to [R.16](#pre-locked-decisions).** Every tier bumps `SCHEMA_VERSION`; full rebuild on mismatch; reject in-place migrations. Empirical rebuild cost (~2s worst case) makes optimisation unjustified.

- **Q16 — Extractor-registration architecture.** **RESOLVED 2026-05-14 — promoted to [R.17](#pre-locked-decisions).** Per-tier extractor modules under `src/extractors/<tier>.ts` exporting `TierExtractor { tierId, register(visitor, ctx) }`; `parser.ts` becomes a thin orchestrator; migration PR ships before Tier 1. (Question added during the grill — not in the original Q1-Q15 numbering.)

- **Q15 — Indexing strategy on new tables.** SQLite indexes for the new tables — which columns get B-tree indexes? `references(file_path, name)`, `references(resolved_symbol_id)`, `jsx_elements(component_name)`, `bindings(resolved_symbol_id)` are the obvious ones. Plan PR for each tier settles its indexing strategy.

---

## Architecture

### Single-pass extraction model

```text
   ┌─────────────────────────────────────────────────────────────┐
   │  parse-worker.ts (one Worker thread per file)                │
   │                                                              │
   │   ┌────────────────────────────────────────────────────┐    │
   │   │  oxc-parser.parseSync(filePath, source, lang)      │    │
   │   │   ↳ returns ASTRoot                                │    │
   │   └─────────────────────┬──────────────────────────────┘    │
   │                         │                                    │
   │                         ▼                                    │
   │   ┌────────────────────────────────────────────────────┐    │
   │   │  Visitor (single tree-walk)                        │    │
   │   │                                                    │    │
   │   │   on each node, dispatch to registered extractors:│    │
   │   │     • Tier 1 extractor (positions on existing)    │    │
   │   │     • Tier 2 extractor (references + scopes)      │    │
   │   │     • Tier 3 extractor (JSX)                      │    │
   │   │     • Tier 4 extractor (type depth)               │    │
   │   │     • Tier 5 extractor (behavioral)               │    │
   │   │     • Tier 9 extractor (test suites)              │    │
   │   │     • Tier 10 extractor (suppressions/markers)    │    │
   │   │     • Tier 11 extractor (metrics)                 │    │
   │   │                                                    │    │
   │   │   each extractor maintains its own per-file state │    │
   │   │   (scope stack, loop context, decorator pending) │    │
   │   └─────────────────────┬──────────────────────────────┘    │
   │                         │                                    │
   │                         ▼                                    │
   │   ┌────────────────────────────────────────────────────┐    │
   │   │  ParsedFile message (rich)                          │    │
   │   │   ↳ symbols, imports, exports, calls,              │    │
   │   │     references, scopes, jsx_elements, …            │    │
   │   └─────────────────────┬──────────────────────────────┘    │
   └─────────────────────────┼────────────────────────────────────┘
                             │
                             ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  index-engine.ts (main thread)                                │
   │                                                              │
   │   ┌──────────────────────────────────────────────────────┐  │
   │   │  Pass 1 — file-local inserts (transactional per file)│  │
   │   │   ↳ symbols, imports, exports, calls, …              │  │
   │   │   ↳ references (file-local resolution)               │  │
   │   │   ↳ scopes                                           │  │
   │   │   ↳ jsx_elements + attributes                        │  │
   │   │   ↳ …                                                │  │
   │   └──────────────────────────────────────────────────────┘  │
   │                         │                                    │
   │                         ▼                                    │
   │   ┌──────────────────────────────────────────────────────┐  │
   │   │  Pass 2 — cross-file binding resolution               │  │
   │   │   ↳ resolve `references` to `symbols` via            │  │
   │   │     imports + exports JOIN                            │  │
   │   │   ↳ populate `bindings`                              │  │
   │   │   ↳ resolve decorator targets                        │  │
   │   │   ↳ resolve JSX element parent links                 │  │
   │   │   ↳ flatten re_export_chains                         │  │
   │   │   ↳ compute module_graph_facts (Tier 12)             │  │
   │   └──────────────────────────────────────────────────────┘  │
   └──────────────────────────────────────────────────────────────┘
```

Pass 2 runs **after all files complete pass 1.** Incremental reindex of N files runs pass 1 per file + a scoped pass 2 over the changed files' binding closure.

### Schema migration approach

Per R.2 + Q14: bump `SCHEMA_VERSION` on every tier; trigger full rebuild on consumer upgrade. The first time a user hits the new schema, the index drops and rebuilds. ~30s on a 100k-symbol project; one-time cost.

Alternative for advanced users: a future `codemap migrate --in-place` command runs additive `ALTER TABLE` for new columns + extracts new tables from existing files without re-parsing. Defer until cheap-migration demand surfaces.

### Worker-thread integration

Per Q13: today's `parse-worker.ts` emits `ParsedFile`. Extend the message shape additively — new fields per tier; existing fields unchanged. Workers don't need new IPC infrastructure; only the message-shape contract grows.

### Index sizing expectations (empirical projection from 2026-05-14 probe)

One-tier projection (extrapolated from the references-only probe measured below in § Operational considerations) holds steady at ~4× DB growth. Multi-tier projection assumes additive cost across tiers — most other tiers extract substantially less data than `references` (positions on existing tables, scope graph, JSX attributes, etc. each add far fewer rows). Conservative multi-tier estimate: ~5-10× growth across all 13 tiers.

| Project size (measured)                | Pre-extraction DB | All-13-tier projected DB | Pre-extraction reindex | All-13-tier projected reindex |
| -------------------------------------- | ----------------- | ------------------------ | ---------------------- | ----------------------------- |
| Small (~900 files, 11k symbols)        | ~11 MB            | ~60-110 MB               | ~280 ms                | ~1-2 s                        |
| Medium-docs (~1.8k files, 8k symbols)  | ~10 MB            | ~50-100 MB               | ~310 ms                | ~1-2 s                        |
| Medium-code (~1.8k files, 27k symbols) | ~18 MB            | ~90-180 MB               | ~570 ms                | ~3-5 s                        |
| Large-app (~2.1k files, 28k symbols)   | ~38 MB            | ~190-380 MB              | ~740 ms                | ~4-6 s                        |

All four projections sit well under the [Floors](../roadmap.md#floors-v1-product-shape)-relevant "codemap becomes a bottleneck" thresholds the user set (full > 1 min, targeted > 1 s). Accept the growth — the database is the product. Per [R.3](#pre-locked-decisions), monorepo users opt out of the expensive tier (`extraction: { references: false }`) and recover ~75% of the DB growth.

---

## The 13 tiers

Each tier is one tracer-bullet PR: parser visitor change + schema migration + 1-2 example recipes + tests + docs entry. Sections below capture: **Goal** (one sentence), **Schema delta** (DDL), **Visitor strategy** (key extraction logic), **Recipes unlocked** (example queries + new recipe candidates), **Effort** (S/M/L with week estimate), **Dependencies** (other tiers that must ship first), **Tier-specific open questions**.

### Tier 1 — Position precision on existing tables — **SHIPPED 2026-05-14**

**Goal:** Make `calls` / `exports` / `symbols` / `markers` column-precise; split `imports.specifiers` JSON blob into a typed child table.

**Ship status:** 4 slices landed; SCHEMA_VERSION 10 → 14; 4 flagship recipes; 4 golden fixtures. Slices A–D summarised below.

| Slice | Substrate                                                                                                                              | Flagship recipe                                  | Schema bump |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------- |
| 1.A   | `calls.{line_start, column_start, column_end}` + `idx_calls_position`                                                                  | `find-call-sites` (`--params callee=…`)          | 10 → 11     |
| 1.B   | `exports.{line_start, line_end, column_start, column_end, is_re_export}` + 2 indexes                                                   | `find-export-sites` (`--params name=…`)          | 11 → 12     |
| 1.C   | `symbols.{name_column_start, name_column_end}` + `markers.{column_start, column_end}`                                                  | `find-symbol-definitions` (`--params name=…`)    | 12 → 13     |
| 1.D   | `import_specifiers` child table (file_path, source, line, column_start/end, imported_name, local_name, kind, is_type_only) + 4 indexes | `find-import-sites` (`--params imported_name=…`) | 13 → 14     |

**Empirical post-Tier-1 cost** (clean rebuild, median of 3 runs):

| Fixture                                            | Pre-Tier-1 DB | Post-Tier-1 DB | Δ DB | Pre-Tier-1 full | Post-Tier-1 full | Δ full | Targeted (post) |
| -------------------------------------------------- | ------------- | -------------- | ---- | --------------- | ---------------- | ------ | --------------- |
| codemap-self (924 files, 11.7k symbols)            | 11.4 MB       | 14.3 MB        | +25% | ~280 ms         | ~300 ms          | +7%    | ~15 ms          |
| merchant-dashboard-v2 (2,120 files, 28.5k symbols) | 37.5 MB       | 50.1 MB        | +33% | ~740 ms         | ~900 ms          | +22%   | ~16 ms          |

Targeted reindex stays flat (~15 ms regardless of project size — Tier 1's adds are per-row not whole-table). Full reindex worst case: 0.9 s on a 2.1k-file enterprise React app — **66× under** R.10's 1-min pain threshold. DB growth (+25-33%) is well under R.9's "~5-10× total across 13 tiers" projection — Tier 1 used ~25-33% of that budget.

**Validation:** 930/930 tests pass · 19 golden scenarios pass (including 4 new) · format clean · lint 0/0 · row counts preserved for unchanged tables.

**Schema delta:**

```sql
ALTER TABLE calls ADD COLUMN line_start          INTEGER NOT NULL;
ALTER TABLE calls ADD COLUMN column_start        INTEGER NOT NULL;
ALTER TABLE calls ADD COLUMN column_end          INTEGER NOT NULL;
ALTER TABLE calls ADD COLUMN args_count          INTEGER NOT NULL;
ALTER TABLE calls ADD COLUMN is_method_call      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN is_constructor_call INTEGER NOT NULL DEFAULT 0;
ALTER TABLE calls ADD COLUMN is_optional_chain   INTEGER NOT NULL DEFAULT 0;

ALTER TABLE exports ADD COLUMN line_start    INTEGER NOT NULL;
ALTER TABLE exports ADD COLUMN line_end      INTEGER NOT NULL;
ALTER TABLE exports ADD COLUMN column_start  INTEGER NOT NULL;
ALTER TABLE exports ADD COLUMN column_end    INTEGER NOT NULL;
ALTER TABLE exports ADD COLUMN is_re_export  INTEGER NOT NULL DEFAULT 0;

ALTER TABLE symbols ADD COLUMN name_column_start INTEGER NOT NULL;
ALTER TABLE symbols ADD COLUMN name_column_end   INTEGER NOT NULL;

ALTER TABLE markers ADD COLUMN column_start INTEGER NOT NULL;
ALTER TABLE markers ADD COLUMN column_end   INTEGER NOT NULL;

CREATE TABLE import_specifiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path     TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  import_id     INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  line          INTEGER NOT NULL,
  column_start  INTEGER NOT NULL,
  column_end    INTEGER NOT NULL,
  imported_name TEXT NOT NULL,
  local_name    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('named','default','namespace','side-effect')),
  is_type_only  INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_import_specifiers_name      ON import_specifiers(imported_name);
CREATE INDEX idx_import_specifiers_filepath  ON import_specifiers(file_path);
```

**Visitor strategy:** Every existing extractor that records a name records `node.name.start` + `node.name.end` (the identifier token, not the parent expression). For `CallExpression`, distinguish `Identifier` callee from `MemberExpression` callee (sets `is_method_call`); flag `NewExpression` (`is_constructor_call`); flag `ChainExpression` parent (`is_optional_chain`); count `arguments.length` (`args_count`). For `imports`, walk each `ImportSpecifier` / `ImportDefaultSpecifier` / `ImportNamespaceSpecifier` and emit `import_specifiers` rows.

**Recipes unlocked:**

```sql
SELECT * FROM calls WHERE callee_name = 'foo' AND is_method_call = 0;

SELECT * FROM import_specifiers WHERE imported_name = 'oldName';
```

New recipe candidates: `dedupe-imports`, `consolidate-type-only-imports`, `stale-imports` (column-precise specifier delete).

**Effort:** S (~1 week). All visitor logic already runs; just record positions.

**Dependencies:** None.

**Tier-specific open questions:**

- (a) Should `args_count` distinguish spread args (`foo(...args)` → unknown count)? Bias toward `NULL` for spread-containing calls.
- (b) `import_specifiers.local_name` vs `imported_name` — `import { foo as bar }` → `imported_name='foo'`, `local_name='bar'`. Both columns required.

---

### Tier 2 — `references` + `scopes` + `bindings` (the load-bearing tier)

**Goal:** Every identifier _use_ — call, type position, JSX, decorator, shorthand, member access, spread — becomes a queryable row. Plus a lexical scope graph and per-reference binding resolution to the originating symbol.

**Schema delta:**

```sql
CREATE TABLE references (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path             TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  line_start            INTEGER NOT NULL,
  column_start          INTEGER NOT NULL,
  column_end            INTEGER NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN (
    'value','type','jsx','decorator','shorthand-prop','shorthand-import',
    'member-access','computed-member','spread','rest','as-cast','typeof','keyof'
  )),
  scope_id              INTEGER REFERENCES scopes(id),
  is_write              INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_references_name        ON references(name);
CREATE INDEX idx_references_filepath    ON references(file_path);
CREATE INDEX idx_references_scope       ON references(scope_id);

CREATE TABLE scopes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path         TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  kind              TEXT NOT NULL CHECK (kind IN (
    'module','function','arrow','block','class','for','catch','with','case'
  )),
  parent_scope_id   INTEGER REFERENCES scopes(id),
  line_start        INTEGER NOT NULL,
  line_end          INTEGER NOT NULL,
  owner_symbol_id   INTEGER REFERENCES symbols(id)
) STRICT;

CREATE INDEX idx_scopes_parent     ON scopes(parent_scope_id);
CREATE INDEX idx_scopes_filepath   ON scopes(file_path);

CREATE TABLE bindings (
  reference_id        INTEGER PRIMARY KEY REFERENCES references(id) ON DELETE CASCADE,
  resolved_symbol_id  INTEGER REFERENCES symbols(id),
  namespace           TEXT NOT NULL CHECK (namespace IN ('value','type','member','default')),
  is_external         INTEGER NOT NULL DEFAULT 0,
  resolution_kind     TEXT NOT NULL CHECK (resolution_kind IN (
    'same-file','imported','re-exported','global','unresolved'
  ))
) STRICT;

CREATE INDEX idx_bindings_resolved ON bindings(resolved_symbol_id);
```

**Visitor strategy:** Two-pass per Q1 + Q2.

**Pass 1 (per file, in worker):** maintain a scope stack; push on entering `Function*Declaration` / `ArrowFunction` / `BlockStatement` / `ClassDeclaration` / `ForStatement` / `CatchClause`. Pop on exit. Every `Identifier` node visit records a `references` row with the current `scope_id`. Distinguish kinds per Q1 of Tier 2: `value` for normal reads, `type` for `TSTypeReference` containers, `jsx` for `JSXIdentifier`, `decorator` for `Decorator` children, `shorthand-prop` for `Property.shorthand`, etc.

**Pass 2 (main thread):** for each `references` row, resolve `bindings`:

1. Same-file lookup: scope-walk upward from `scope_id` looking for a `symbols` row with matching name + compatible namespace.
2. If no same-file match: check `imports` for matching `local_name` in same file; if found, follow to `import_specifiers` → `exports` → `symbols` in the resolved-path file.
3. If still unresolved: re-export chain walk via Tier 6's `re_export_chains`.
4. If still unresolved: mark `resolution_kind = 'global'` (e.g. `console`, `window`) or `'unresolved'`.

**Recipes unlocked:**

```sql
SELECT r.* FROM references r
  JOIN bindings b ON b.reference_id = r.id
  JOIN symbols s ON s.id = b.resolved_symbol_id
WHERE s.name = 'usePermissions' AND b.namespace = 'value';

SELECT r1.*, r2.scope_id AS shadowed_by_scope
FROM references r1
JOIN references r2 ON r1.name = r2.name AND r1.file_path = r2.file_path
WHERE r1.scope_id != r2.scope_id AND r1.kind = 'value';

SELECT s.name, COUNT(r.id) AS reads, SUM(r.is_write) AS writes
FROM symbols s
LEFT JOIN bindings b ON b.resolved_symbol_id = s.id
LEFT JOIN references r ON r.id = b.reference_id
GROUP BY s.id;

SELECT * FROM symbols s
WHERE s.is_exported = 1
  AND NOT EXISTS (
    SELECT 1 FROM bindings b
    JOIN references r ON r.id = b.reference_id
    WHERE b.resolved_symbol_id = s.id
      AND r.file_path != s.file_path
  );
```

New recipe candidates: `rename-app-wide` (extends `rename-preview` to JOIN `references`); `unused-export` (precise; subsumes the heuristic `unimported-exports`); `shadowed-names`; `unused-locals`; `find-typeof-uses`.

**Effort:** L (~3 weeks). Biggest single oxc-visitor expansion in the entire plan. Scope-stack discipline + cross-file pass 2 + benchmark validation against medium-size project.

**Dependencies:** Tier 1 (need column positions to populate `references`).

**Tier-specific open questions:**

- (a) `references.is_write` — **RESOLVED 2026-05-14 → [R.13](#pre-locked-decisions).** Boolean column; compound assignment emits two rows (one read, one write).
- (b) Per Q2 / R.12: pre-resolution settled.
- (c) Per Q12 / R.14: FTS5 stays file-content-only; B-tree index on `references.name` is the strategy.

---

### Tier 3 — JSX elements + attributes

**Goal:** Every JSX element + every JSX attribute becomes a queryable row with column-precise positions.

**Schema delta:**

```sql
CREATE TABLE jsx_elements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path         TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  component_name    TEXT NOT NULL,
  line_start        INTEGER NOT NULL,
  line_end          INTEGER NOT NULL,
  column_start      INTEGER NOT NULL,
  column_end        INTEGER NOT NULL,
  is_self_closing   INTEGER NOT NULL DEFAULT 0,
  is_fragment       INTEGER NOT NULL DEFAULT 0,
  namespace_prefix  TEXT,
  parent_element_id INTEGER REFERENCES jsx_elements(id),
  children_count    INTEGER NOT NULL DEFAULT 0,
  is_lowercase      INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX idx_jsx_elements_name      ON jsx_elements(component_name);
CREATE INDEX idx_jsx_elements_filepath  ON jsx_elements(file_path);

CREATE TABLE jsx_attributes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  element_id   INTEGER NOT NULL REFERENCES jsx_elements(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  line         INTEGER NOT NULL,
  column_start INTEGER NOT NULL,
  column_end   INTEGER NOT NULL,
  value_kind   TEXT NOT NULL CHECK (value_kind IN ('string','expression','boolean','spread','element')),
  value_text   TEXT
) STRICT;

CREATE INDEX idx_jsx_attrs_name      ON jsx_attributes(name);
CREATE INDEX idx_jsx_attrs_element   ON jsx_attributes(element_id);
```

**Visitor strategy:** Visit `JSXElement` / `JSXFragment` nodes. Record element name from `JSXOpeningElement.name`. For each `JSXAttribute` child, record name + value (string literal text, expression source text, or `'spread'` for `JSXSpreadAttribute`). Track parent linkage in a post-emit pass (Q4) — element IDs assigned eagerly; `parent_element_id` filled after the full file's tree is collected. `is_lowercase` distinguishes HTML elements (`<div>`) from React components (`<Div>`).

**Recipes unlocked:**

```sql
SELECT e.* FROM jsx_elements e
WHERE e.component_name = 'Link';

SELECT e.file_path, e.line_start, a.value_text
FROM jsx_elements e
JOIN jsx_attributes a ON a.element_id = e.id
WHERE e.component_name = 'Button' AND a.name = 'onClick';

SELECT a.* FROM jsx_attributes a
WHERE a.value_kind = 'spread';

SELECT * FROM jsx_elements WHERE component_name = 'Foo' AND children_count = 0;
```

New recipe candidates: `rename-component` (alongside `rename-app-wide`); `migrate-jsx-prop`; `find-spread-props`; `unused-jsx-components`.

**Effort:** M (~1-2 weeks). oxc parser exposes JSX nodes natively; straightforward visitor pass. Parent-linking post-pass adds slight complexity.

**Dependencies:** Tier 1 (column positions), Tier 2 (`references` row per JSX element name → enables JOIN to bindings).

**Tier-specific open questions:**

- (a) Should `value_text` capture the literal source text or normalised form? Source text — recipes that rewrite need to know what's actually there.
- (b) Fragment shorthand `<>...</>` — emit a `jsx_elements` row with `is_fragment = 1` and `component_name = ''`? Yes.
- (c) Children — emit as rows linked via `parent_element_id`, or only count? Both — children get rows AND parent has `children_count`.

---

### Tier 4 — Type / signature depth (params, generics, predicates)

**Goal:** Function parameters + generic parameters + type predicates + return types become structured queryable facts, not just stringified into `symbols.signature`.

**Schema delta:**

```sql
CREATE TABLE function_params (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol_id           INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  position            INTEGER NOT NULL,
  name                TEXT NOT NULL,
  type_text           TEXT,
  default_value       TEXT,
  is_optional         INTEGER NOT NULL DEFAULT 0,
  is_rest             INTEGER NOT NULL DEFAULT 0,
  is_destructured     INTEGER NOT NULL DEFAULT 0,
  destructured_names  TEXT
) STRICT;

CREATE INDEX idx_function_params_symbol ON function_params(symbol_id);
CREATE INDEX idx_function_params_type   ON function_params(type_text);

CREATE TABLE generic_params (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol_id       INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,
  name            TEXT NOT NULL,
  constraint_text TEXT,
  default_text    TEXT
) STRICT;

CREATE INDEX idx_generic_params_symbol ON generic_params(symbol_id);

CREATE TABLE type_predicates (
  symbol_id   INTEGER PRIMARY KEY REFERENCES symbols(id) ON DELETE CASCADE,
  param_name  TEXT NOT NULL,
  target_type TEXT NOT NULL,
  is_asserts  INTEGER NOT NULL DEFAULT 0
) STRICT;

ALTER TABLE symbols ADD COLUMN return_type    TEXT;
ALTER TABLE symbols ADD COLUMN is_async       INTEGER NOT NULL DEFAULT 0;
ALTER TABLE symbols ADD COLUMN is_generator   INTEGER NOT NULL DEFAULT 0;
ALTER TABLE symbols ADD COLUMN throws_clauses TEXT;
```

**Visitor strategy:** When visiting `FunctionDeclaration` / `MethodDefinition` / `ArrowFunctionExpression` / `FunctionExpression`, after the existing symbol-row insert, also extract params via `node.params` and generics via `node.typeParameters`. For each `params[i]`: name from `Identifier` / `ObjectPattern` / `ArrayPattern` / `RestElement`; type from `TSTypeAnnotation`; default from `AssignmentPattern.right`. For `RestElement` set `is_rest`. For `ObjectPattern` / `ArrayPattern` set `is_destructured` + capture destructured names. Return type from `node.returnType`. `is_async` / `is_generator` from `node.async` / `node.generator`. Type predicates from `TSTypePredicate` return-type-annotation node.

**Recipes unlocked:**

```sql
SELECT s.name, s.file_path
FROM symbols s
JOIN function_params p ON p.symbol_id = s.id
WHERE p.type_text LIKE '%Date%';

SELECT s.name FROM symbols s
JOIN generic_params g ON g.symbol_id = s.id
WHERE g.constraint_text IS NULL;

SELECT * FROM type_predicates;

SELECT * FROM symbols WHERE is_async = 1 AND return_type LIKE '%Promise<void>%';
```

New recipe candidates: `swap-positional-to-named-args` (extends `rename-preview`); `find-untyped-params`; `find-unused-generics`; `migrate-callbacks-to-async`.

**Effort:** M (~2 weeks). Type stringification logic exists for `signature`; extend to per-param + per-generic.

**Dependencies:** Tier 1 (column positions used by recipes that rewrite parameters).

**Tier-specific open questions:**

- (a) Per Q3: type-text normalization shape? Source text by default; normalized form deferred.
- (b) `throws_clauses` — TS doesn't have a `throws` syntax (it's JSDoc); should this column derive from JSDoc `@throws` tags (Tier 5) instead?
- (c) Overloads — a function with multiple signatures has multiple `symbols` rows or one? One `symbols` row + multiple `function_params` clusters distinguished by overload position. Plan PR settles.

---

### Tier 5 — Behavioral facts (async, try/catch, decorators, structured JSDoc)

**Goal:** Capture runtime-shape behavioral facts the AST encodes but today's index discards.

**Schema delta:**

```sql
CREATE TABLE async_calls (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path           TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  caller_scope        TEXT NOT NULL,
  awaited_expression  TEXT,
  awaited_callee_name TEXT,
  line_start          INTEGER NOT NULL,
  column_start        INTEGER NOT NULL,
  in_loop             INTEGER NOT NULL DEFAULT 0,
  in_try              INTEGER NOT NULL DEFAULT 0,
  scope_id            INTEGER REFERENCES scopes(id)
) STRICT;

CREATE INDEX idx_async_calls_callee  ON async_calls(awaited_callee_name);
CREATE INDEX idx_async_calls_filepath ON async_calls(file_path);

CREATE TABLE try_catch (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path           TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  containing_scope_id INTEGER REFERENCES scopes(id),
  try_line_start      INTEGER NOT NULL,
  try_line_end        INTEGER NOT NULL,
  has_catch           INTEGER NOT NULL DEFAULT 0,
  catch_param         TEXT,
  catch_rethrows      INTEGER NOT NULL DEFAULT 0,
  catch_logs_only     INTEGER NOT NULL DEFAULT 0,
  has_finally         INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE decorators (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  target_symbol_id INTEGER REFERENCES symbols(id),
  target_kind     TEXT NOT NULL CHECK (target_kind IN ('class','method','property','parameter','accessor')),
  name            TEXT NOT NULL,
  line            INTEGER NOT NULL,
  column_start    INTEGER NOT NULL,
  args_text       TEXT
) STRICT;

CREATE INDEX idx_decorators_name   ON decorators(name);
CREATE INDEX idx_decorators_target ON decorators(target_symbol_id);

CREATE TABLE jsdoc_tags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol_id     INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
  tag           TEXT NOT NULL,
  name          TEXT,
  type_text     TEXT,
  description   TEXT
) STRICT;

CREATE INDEX idx_jsdoc_tags_symbol ON jsdoc_tags(symbol_id);
CREATE INDEX idx_jsdoc_tags_tag    ON jsdoc_tags(tag);
```

**Visitor strategy:**

- **Async calls:** every `AwaitExpression` node; `awaited_callee_name` = caller name if argument is `CallExpression`. Track `in_loop` / `in_try` via context stack per Q5.
- **Try/catch:** every `TryStatement` node. `catch_rethrows` flag: scan catch body for `ThrowStatement` whose argument references the catch param. `catch_logs_only` flag: catch body only contains `console.*` calls and no `throw`.
- **Decorators:** every `Decorator` node; post-pass link to following `ClassDeclaration` / `MethodDefinition` / `PropertyDefinition` / `Parameter` per Q6.
- **JSDoc tags:** existing JSDoc parsing already extracts `@deprecated` / visibility tags; extend to ALL recognised tags (`@param`, `@returns`, `@throws`, `@see`, `@link`, `@example`, `@since`, `@template`, `@typedef`, custom). One row per tag per symbol.

**Recipes unlocked:**

```sql
SELECT * FROM async_calls WHERE in_loop = 1;

SELECT * FROM try_catch WHERE catch_logs_only = 1 AND has_catch = 1;

SELECT d.name, COUNT(*) AS classes
FROM decorators d
WHERE d.target_kind = 'class'
GROUP BY d.name
HAVING classes > 1;

SELECT s.name, t.tag, t.description
FROM symbols s
JOIN jsdoc_tags t ON t.symbol_id = s.id
WHERE t.tag = '@deprecated' AND s.is_exported = 1;
```

New recipe candidates: `find-awaits-in-loops`; `find-empty-catches`; `find-deprecated-with-replacement`; `decorator-audit`.

**Effort:** M (~2 weeks). JSDoc parsing already partially happens; promote to structured tags. Decorator post-pass + try/catch flag detection are new.

**Dependencies:** Tier 2 (`scope_id`).

**Tier-specific open questions:**

- (a) `catch_rethrows` — naive detection misses chained calls. Plan PR for Tier 5 settles heuristic: any `throw` statement in catch body whose argument is a `MemberExpression` of the catch param or just the catch-param identifier.
- (b) Per Q7: JSDoc tag schema — structured wins; `@param x {Foo} description` → `name='x'`, `type_text='Foo'`, `description='description'`.
- (c) `async_calls.awaited_expression` — full source text of the awaited expression, or just the callee name? Source text; cheap to capture; recipes that rewrite need it.

---

### Tier 6 — Module-graph enrichment

**Goal:** Flatten re-export chains; record dynamic imports; mark barrel files.

**Schema delta:**

```sql
CREATE TABLE re_export_chains (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_file_path  TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  origin_name       TEXT NOT NULL,
  final_file_path   TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  final_name        TEXT NOT NULL,
  hops              INTEGER NOT NULL,
  chain_path        TEXT NOT NULL
) STRICT;

CREATE INDEX idx_re_export_origin ON re_export_chains(origin_file_path, origin_name);
CREATE INDEX idx_re_export_final  ON re_export_chains(final_file_path, final_name);

CREATE TABLE dynamic_imports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  line_start      INTEGER NOT NULL,
  column_start    INTEGER NOT NULL,
  source_kind     TEXT NOT NULL CHECK (source_kind IN ('literal','template','expression')),
  source_text     TEXT,
  resolved_path   TEXT,
  in_async_fn     INTEGER NOT NULL DEFAULT 0,
  scope_id        INTEGER REFERENCES scopes(id)
) STRICT;

ALTER TABLE files ADD COLUMN is_barrel        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN is_entry         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE files ADD COLUMN has_side_effects INTEGER NOT NULL DEFAULT 0;
```

**Visitor strategy:**

- **Re-export chains:** post-pass over all `exports` rows where `re_export_source IS NOT NULL`. Walk the chain: start at origin, follow `re_export_source` until reaching a non-re-export (the final defining file). Record each hop count + chain path.
- **Dynamic imports:** visit `ImportExpression` (the `import('./foo')` form). `source_kind` = `'literal'` for string-literal arg, `'template'` for template-literal arg, `'expression'` for runtime-computed arg. Resolved path via existing oxc-resolver for literals only.
- **`files.is_barrel`:** post-pass per file — `is_barrel = 1` if the file's symbols are 100% re-exports (`exports.re_export_source IS NOT NULL`) AND no value-symbol definitions.
- **`files.is_entry`:** stub for C.9 plugin layer; default 0 today; populated via config when C.9 ships.
- **`files.has_side_effects`:** derived from `package.json` `sideEffects` field (Tier 8) OR presence of top-level `CallExpression` / `AssignmentExpression`.

**Recipes unlocked:**

```sql
SELECT * FROM re_export_chains
WHERE origin_file_path = 'src/index.ts' AND origin_name = 'foo';

SELECT * FROM dynamic_imports WHERE source_kind = 'literal' AND in_async_fn = 0;

SELECT * FROM files WHERE is_barrel = 1;

SELECT s.name, c.final_file_path
FROM symbols s
JOIN re_export_chains c
  ON c.origin_file_path = s.file_path AND c.origin_name = s.name
WHERE c.hops > 2;
```

New recipe candidates: `barrel-cleanup`; `flatten-re-export-chain`; `find-dynamic-import-leaks`.

**Effort:** M (~1 week). Mostly post-pass derivation; relies on existing `exports.re_export_source`.

**Dependencies:** Tier 1 (column positions for `dynamic_imports`).

**Tier-specific open questions:**

- (a) Re-export chains across packages (npm-installed deps) — track or stop at first non-resolvable hop? Stop; codemap doesn't index `node_modules` symbols.
- (b) `dynamic_imports` `source_kind = 'expression'` — record the source text for recipe filtering, or leave NULL? Record — `'expression'` shouldn't lose information.

---

### Tier 7 — CSS richness (rules, at-rules, declarations)

**Goal:** Structural CSS — every rule, every at-rule, every declaration with position.

**Schema delta:**

```sql
CREATE TABLE css_rules (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path          TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  selector           TEXT NOT NULL,
  specificity        INTEGER NOT NULL,
  line_start         INTEGER NOT NULL,
  line_end           INTEGER NOT NULL,
  has_important      INTEGER NOT NULL DEFAULT 0,
  declarations_count INTEGER NOT NULL,
  parent_at_rule_id  INTEGER REFERENCES css_at_rules(id)
) STRICT;

CREATE INDEX idx_css_rules_filepath ON css_rules(file_path);

CREATE TABLE css_at_rules (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path         TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  condition_text    TEXT,
  line_start        INTEGER NOT NULL,
  line_end          INTEGER NOT NULL,
  parent_at_rule_id INTEGER REFERENCES css_at_rules(id)
) STRICT;

CREATE INDEX idx_css_at_rules_kind     ON css_at_rules(kind);
CREATE INDEX idx_css_at_rules_filepath ON css_at_rules(file_path);

CREATE TABLE css_declarations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id      INTEGER NOT NULL REFERENCES css_rules(id) ON DELETE CASCADE,
  property     TEXT NOT NULL,
  value        TEXT NOT NULL,
  is_important INTEGER NOT NULL DEFAULT 0,
  line         INTEGER NOT NULL,
  column_start INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_css_decls_property ON css_declarations(property);
```

**Visitor strategy:** Lightning CSS visitor already walks `Rule` / `MediaQuery` / `Declaration` nodes. Extend the existing `css-parser.ts` to emit the new row shapes alongside existing `css_classes` / `css_variables` / `css_keyframes`. Specificity computed inline per CSS spec rules (id + class + element counts).

**Recipes unlocked:**

```sql
SELECT * FROM css_rules WHERE has_important = 1;

SELECT a.* FROM css_at_rules a
WHERE a.kind = '@media' AND a.condition_text LIKE '%max-width: 768px%';

SELECT property, COUNT(*) AS uses
FROM css_declarations
GROUP BY property
ORDER BY uses DESC LIMIT 20;

SELECT r.selector, r.file_path
FROM css_rules r
LEFT JOIN jsx_attributes a
  ON a.name = 'className' AND a.value_text LIKE '%' || REPLACE(r.selector, '.', '') || '%'
WHERE a.id IS NULL AND r.selector LIKE '.%';
```

New recipe candidates: `dead-css-rules`; `important-overrides-audit`; `responsive-breakpoint-audit`.

**Effort:** M (~1-2 weeks). Lightning CSS visitor extension; structurally similar to existing `css_classes` extraction.

**Dependencies:** None (parallel-safe to Tier 1-6).

**Tier-specific open questions:**

- (a) `css_declarations` could be enormous (every `prop: value` line). Index size impact for design-system-heavy projects. Worth measuring before commit.
- (b) Nested at-rules (`@media` inside `@supports` inside `@layer`) — `parent_at_rule_id` handles N-deep nesting fine.
- (c) Sass / Less / SCSS — out of scope (existing roadmap backlog item).

---

### Tier 8 — Project meta (tsconfig + package.json)

**Goal:** Resolved per-file tsconfig + package.json facts queryable.

**Schema delta:**

```sql
CREATE TABLE tsconfig_options (
  file_path        TEXT PRIMARY KEY REFERENCES files(path) ON DELETE CASCADE,
  strict           INTEGER NOT NULL DEFAULT 0,
  no_implicit_any  INTEGER NOT NULL DEFAULT 0,
  strict_null_checks INTEGER NOT NULL DEFAULT 0,
  target           TEXT,
  module           TEXT,
  module_resolution TEXT,
  jsx              TEXT,
  lib              TEXT,
  resolved_paths   TEXT,
  base_url         TEXT,
  experimental_decorators INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE package_json_meta (
  file_path        TEXT PRIMARY KEY REFERENCES files(path) ON DELETE CASCADE,
  package_path     TEXT NOT NULL,
  package_name     TEXT,
  package_version  TEXT,
  type             TEXT,
  main             TEXT,
  module_path      TEXT,
  exports_map      TEXT,
  types_path       TEXT,
  side_effects     TEXT
) STRICT;

CREATE INDEX idx_pkg_json_name ON package_json_meta(package_name);
```

**Visitor strategy:** Existing config loader already reads tsconfig; extend to record resolved options per file. Walk up the directory tree from each `files.path` to find the nearest `tsconfig.json` (or extends-chain final form) + nearest `package.json`. Single resolution per file, cached.

**Recipes unlocked:**

```sql
SELECT path FROM tsconfig_options WHERE strict = 0;

SELECT package_name, COUNT(*) AS files
FROM package_json_meta
GROUP BY package_name;

SELECT path FROM package_json_meta WHERE types_path IS NULL AND package_name IS NOT NULL;
```

New recipe candidates: `strict-mode-audit`; `missing-types-fields`; `monorepo-package-boundaries`.

**Effort:** S (~3-5 days). Config files already loaded; just persist resolved view.

**Dependencies:** None.

**Tier-specific open questions:**

- (a) `package.json` `exports` field — store as JSON text or parse into a child table? JSON text — too many shapes (conditional / wildcard / nested).
- (b) tsconfig `extends` chain — store final resolved options or each layer? Final resolved.

---

### Tier 9 — Test-suite metadata

**Goal:** Test files become structurally queryable — describe / it / test hierarchy, fixtures, skipped tests, assertion counts.

**Schema delta:**

```sql
CREATE TABLE test_suites (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path           TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  kind                TEXT NOT NULL CHECK (kind IN ('describe','it','test','suite','it.each','test.each')),
  line_start          INTEGER NOT NULL,
  line_end            INTEGER NOT NULL,
  parent_suite_id     INTEGER REFERENCES test_suites(id),
  is_skipped          INTEGER NOT NULL DEFAULT 0,
  is_only             INTEGER NOT NULL DEFAULT 0,
  is_todo             INTEGER NOT NULL DEFAULT 0,
  framework           TEXT NOT NULL CHECK (framework IN ('vitest','jest','node-test','mocha','bun-test','unknown'))
) STRICT;

CREATE INDEX idx_test_suites_filepath ON test_suites(file_path);
CREATE INDEX idx_test_suites_parent   ON test_suites(parent_suite_id);

CREATE TABLE test_fixtures (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id        INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
  file_path       TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('beforeAll','beforeEach','afterEach','afterAll')),
  line_start      INTEGER NOT NULL,
  line_end        INTEGER NOT NULL
) STRICT;

CREATE TABLE test_assertions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id     INTEGER REFERENCES test_suites(id) ON DELETE CASCADE,
  file_path    TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  matcher_name TEXT NOT NULL,
  line         INTEGER NOT NULL,
  column_start INTEGER NOT NULL
) STRICT;

CREATE INDEX idx_test_assertions_suite   ON test_assertions(suite_id);
CREATE INDEX idx_test_assertions_matcher ON test_assertions(matcher_name);
```

**Visitor strategy:** Per Q8 — detect test files by `.test.` / `.spec.` extension OR presence of `vitest` / `jest` / `node:test` / `mocha` / `bun:test` import. Inside test files, walk `CallExpression` nodes whose callee is `describe` / `it` / `test` / `suite` (or `.skip` / `.only` / `.todo` / `.each` variants). Track parent suite via call-stack-shape context. Walk `expect(...)` calls and capture the matcher name (chained method).

**Recipes unlocked:**

```sql
SELECT * FROM test_suites WHERE is_skipped = 1 OR is_only = 1;

SELECT s.* FROM test_suites s
LEFT JOIN test_assertions a ON a.suite_id = s.id
WHERE s.kind IN ('it','test') AND a.id IS NULL;

SELECT s.name, COUNT(t.id) AS tests
FROM symbols s
LEFT JOIN test_suites t
  ON t.name LIKE '%' || s.name || '%' AND t.file_path LIKE 'src/%test%'
WHERE s.is_exported = 1
GROUP BY s.id
HAVING tests = 0;

SELECT * FROM test_fixtures WHERE kind = 'beforeEach';
```

New recipe candidates: `find-skipped-tests`; `find-tests-without-assertions`; `untested-exports`; `test-fan-out-audit`.

**Effort:** M (~2 weeks). Test-framework detection per Q8 + AST walking + assertion-matcher capture.

**Dependencies:** Tier 1 (positions), Tier 2 (`scope_id` for nested describes).

**Tier-specific open questions:**

- (a) `it.each([...])` parametrised tests — one row or N rows? One row with `is_parametrised: 1` flag; row count multiplication is a runtime concern.
- (b) Cross-framework matcher mapping — vitest's `.toEqual` ≈ jest's `.toStrictEqual`. Don't normalise; record as-written.
- (c) `bun:test` and `node:test` — newer frameworks; visitor must recognise their import shape.

---

### Tier 10 — Lint suppressions + runtime/dev markers

**Goal:** Extend existing `markers` + `suppressions` tables to cover `eslint-disable-*`, `ts-expect-error`, `ts-ignore`, `// @ts-nocheck`, `console.*`, `debugger`, dev-only branches.

**Schema delta:**

```sql
ALTER TABLE suppressions ADD COLUMN tool TEXT NOT NULL DEFAULT 'codemap';
ALTER TABLE suppressions ADD COLUMN rule_name TEXT;
ALTER TABLE suppressions ADD COLUMN reason TEXT;

CREATE TABLE runtime_markers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path    TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('console','debugger','throw','assert','process-env','globalThis')),
  line_start   INTEGER NOT NULL,
  column_start INTEGER NOT NULL,
  detail       TEXT,
  scope_id     INTEGER REFERENCES scopes(id)
) STRICT;

CREATE INDEX idx_runtime_markers_kind ON runtime_markers(kind);
CREATE INDEX idx_runtime_markers_file ON runtime_markers(file_path);

CREATE TABLE dev_only_branches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  condition_text  TEXT NOT NULL,
  line_start      INTEGER NOT NULL,
  line_end        INTEGER NOT NULL,
  body_token_count INTEGER NOT NULL
) STRICT;
```

**Visitor strategy:**

- Extend marker extraction to recognise `eslint-disable-next-line`, `eslint-disable-line`, `eslint-disable`, `ts-expect-error`, `ts-ignore`, `@ts-nocheck` — record in `suppressions` with `tool` + `rule_name` + `reason`.
- Visit `CallExpression` with callee like `console.<method>` — emit `runtime_markers` row.
- Visit `DebuggerStatement` — emit `runtime_markers` row.
- Visit `ThrowStatement` — emit `runtime_markers` row with thrown-expression text.
- Visit `MemberExpression` like `process.env.X` — emit `runtime_markers` row with env-var name.
- Visit `IfStatement` whose test matches `process.env.NODE_ENV === 'development'` / `'DEBUG'` patterns — emit `dev_only_branches`.

**Recipes unlocked:**

```sql
SELECT * FROM suppressions WHERE tool = 'eslint' AND rule_name = 'no-console';

SELECT * FROM runtime_markers WHERE kind = 'console' AND file_path LIKE 'src/%';

SELECT * FROM runtime_markers WHERE kind = 'process-env' AND detail = 'NODE_ENV';

SELECT * FROM dev_only_branches WHERE body_token_count > 50;
```

New recipe candidates: `find-leftover-console`; `find-debugger-statements`; `env-var-audit`; `dev-only-code-shipped`.

**Effort:** S (~1 week). Existing `markers` / `suppressions` machinery extends naturally.

**Dependencies:** Tier 2 (`scope_id`).

**Tier-specific open questions:**

- (a) `dev_only_branches` detection — what patterns count? `NODE_ENV === 'development'`, `DEBUG`, `process.env.<X>` truthiness checks, `__DEV__` global. List in plan PR.
- (b) `eslint-disable` with multi-rule (`eslint-disable no-console no-alert`) — N rows or one with comma-separated rule_name? N rows; one rule per row.

---

### Tier 11 — Metrics expansion (per-symbol + per-file)

**Goal:** Cheap-to-compute facts that enable refactor / size / style recipes.

**Schema delta:**

```sql
ALTER TABLE symbols ADD COLUMN body_token_count   INTEGER;
ALTER TABLE symbols ADD COLUMN body_line_count    INTEGER;
ALTER TABLE symbols ADD COLUMN nesting_depth      INTEGER;
ALTER TABLE symbols ADD COLUMN param_count        INTEGER;
ALTER TABLE symbols ADD COLUMN local_var_count    INTEGER;
ALTER TABLE symbols ADD COLUMN early_return_count INTEGER;

CREATE TABLE file_metrics (
  file_path                 TEXT PRIMARY KEY REFERENCES files(path) ON DELETE CASCADE,
  total_lines               INTEGER NOT NULL,
  code_lines                INTEGER NOT NULL,
  comment_lines             INTEGER NOT NULL,
  blank_lines               INTEGER NOT NULL,
  total_tokens              INTEGER NOT NULL,
  arrow_function_count      INTEGER NOT NULL DEFAULT 0,
  function_declaration_count INTEGER NOT NULL DEFAULT 0,
  optional_chaining_count   INTEGER NOT NULL DEFAULT 0,
  nullish_coalescing_count  INTEGER NOT NULL DEFAULT 0,
  let_count                 INTEGER NOT NULL DEFAULT 0,
  const_count               INTEGER NOT NULL DEFAULT 0,
  var_count                 INTEGER NOT NULL DEFAULT 0,
  default_export_count      INTEGER NOT NULL DEFAULT 0,
  named_export_count        INTEGER NOT NULL DEFAULT 0,
  top_level_await_count     INTEGER NOT NULL DEFAULT 0,
  template_literal_count    INTEGER NOT NULL DEFAULT 0,
  tagged_template_count     INTEGER NOT NULL DEFAULT 0
) STRICT;
```

**Visitor strategy:**

- **Per-symbol metrics:** during visitor pass over function/method bodies, increment counters: `body_token_count` (cumulative tokens in body), `nesting_depth` (max conditional/loop nesting), `local_var_count` (`VariableDeclarator` count in own scope), `early_return_count` (return statements before final).
- **Per-file metrics:** single counter pass per file; cheap (one walk; increment counters per node kind).
- **Code / comment / blank lines:** existing line counter logic; tokenize comments separately.

**Recipes unlocked:**

```sql
SELECT name, file_path, body_token_count
FROM symbols
WHERE body_token_count > 500
ORDER BY body_token_count DESC LIMIT 20;

SELECT file_path
FROM file_metrics
WHERE var_count > 0
ORDER BY var_count DESC;

SELECT s.name, s.complexity, s.nesting_depth, s.param_count
FROM symbols s
WHERE s.kind = 'function' AND s.complexity > 10 AND s.nesting_depth > 4;

SELECT file_path, optional_chaining_count
FROM file_metrics
WHERE optional_chaining_count > 20;
```

New recipe candidates: `refactor-large-functions` (extends `refactor-risk-ranking`); `var-to-const-migration`; `style-audit`.

**Effort:** S (~1 week). Pure counting; no AST shape analysis beyond visitor presence.

**Dependencies:** None (parallel-safe to all tiers).

**Tier-specific open questions:**

- (a) "Token count" — exactly what counts? oxc's tokeniser output, or simple split-on-whitespace? oxc tokeniser — fewer surprises.
- (b) `nesting_depth` — does ternary count as +1 nesting? Yes.
- (c) `comment_lines` — block comment spanning N lines counts as N, or 1? N.

---

### Tier 12 — Module-graph topology

**Goal:** Strongly-connected components, cycle detection, depth-from-entry, topological order — pre-computed at index time.

**Schema delta:**

```sql
CREATE TABLE module_graph_facts (
  file_path          TEXT PRIMARY KEY REFERENCES files(path) ON DELETE CASCADE,
  topological_index  INTEGER,
  cycle_id           INTEGER,
  cycle_size         INTEGER,
  depth_from_entry   INTEGER,
  fan_in             INTEGER NOT NULL DEFAULT 0,
  fan_out            INTEGER NOT NULL DEFAULT 0,
  is_terminal        INTEGER NOT NULL DEFAULT 0,
  is_reachable       INTEGER NOT NULL DEFAULT 0,
  centrality         REAL
) STRICT;

CREATE INDEX idx_module_graph_cycle    ON module_graph_facts(cycle_id);
CREATE INDEX idx_module_graph_topology ON module_graph_facts(topological_index);
```

**Visitor strategy:** Pure post-pass. After all `dependencies` rows are populated, run:

1. **Tarjan's strongly-connected-components** over the dependencies graph → assigns `cycle_id` and `cycle_size` (rows in non-trivial SCCs).
2. **Topological sort** (over the cycle-collapsed DAG) → assigns `topological_index`.
3. **BFS from entry points** (post-C.9 from `files.is_entry`; today from heuristic entries — `src/index.ts`, `src/main.ts`, package.json `main` / `module`) → assigns `depth_from_entry` and `is_reachable`.
4. **Fan-in / fan-out** — COUNT of incoming / outgoing edges in `dependencies`.
5. **`is_terminal`** — `fan_out = 0`.
6. **`centrality`** — eigenvector centrality (or PageRank) over the dependency graph. Optional; defer if perf-prohibitive.

**Recipes unlocked:**

```sql
SELECT * FROM module_graph_facts WHERE cycle_id IS NOT NULL;

SELECT * FROM module_graph_facts WHERE depth_from_entry > 10;

SELECT * FROM files WHERE path NOT IN (SELECT file_path FROM module_graph_facts WHERE is_reachable = 1);

SELECT * FROM module_graph_facts ORDER BY centrality DESC LIMIT 10;
```

New recipe candidates: `find-import-cycles`; `dead-files-by-reachability` (subsumes C.9 plan's main goal); `module-centrality-audit`; `dependency-depth-distribution`.

**Effort:** M (~1-2 weeks). Standard graph algorithms; SQLite supports recursive CTE for fallback if needed.

**Dependencies:** Tier 6 (`files.is_entry` for proper reachability; without it, use heuristic entry detection).

**Tier-specific open questions:**

- (a) Centrality — eigenvector vs PageRank vs betweenness? Eigenvector for cheap O(V+E) approximation; defer betweenness (O(V·E) — too slow on large graphs).
- (b) Heuristic entry detection until C.9 — list of entry candidates: `src/index.ts`, `src/main.ts`, `src/cli/main.ts`, package.json `main` / `module` / `bin`, Next.js `app/**/page.tsx`, etc.
- (c) Recursive CTE vs JS-side graph algorithm? JS-side — SQLite's recursive CTE on cycle-containing graphs is slow.

---

### Tier 13 — ORM / SQL string tracking

**Goal:** Database-schema-aware recipes — find ORM model definitions, SQL template literals, migration files.

**Schema delta:**

```sql
CREATE TABLE orm_models (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path      TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  model_name     TEXT NOT NULL,
  framework      TEXT NOT NULL CHECK (framework IN ('prisma','drizzle','typeorm','mongoose','sequelize','kysely','knex','sqlx','unknown')),
  table_name     TEXT,
  line_start     INTEGER NOT NULL,
  line_end       INTEGER NOT NULL,
  fields_json    TEXT NOT NULL
) STRICT;

CREATE INDEX idx_orm_models_name      ON orm_models(model_name);
CREATE INDEX idx_orm_models_framework ON orm_models(framework);

CREATE TABLE sql_strings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path     TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  line_start    INTEGER NOT NULL,
  column_start  INTEGER NOT NULL,
  query_text    TEXT NOT NULL,
  framework     TEXT,
  uses_template INTEGER NOT NULL DEFAULT 0,
  has_concat    INTEGER NOT NULL DEFAULT 0,
  is_parameterised INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE db_migrations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path     TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
  migration_name TEXT NOT NULL,
  framework     TEXT,
  up_sql        TEXT,
  down_sql      TEXT,
  applied_at    TEXT
) STRICT;
```

**Visitor strategy:**

- **ORM detection:** look for known patterns — Prisma model file (`schema.prisma` — separate parser); Drizzle `sqliteTable('foo', { ... })` / `pgTable('foo', { ... })` calls; TypeORM `@Entity` decorator (links to Tier 5 decorators); Mongoose `mongoose.Schema(...)` calls.
- **SQL strings:** tagged template literals like `sql\`SELECT ...\``; raw string literals containing SQL-keyword sequences (`SELECT`, `INSERT`, `UPDATE`, `DELETE` followed by known SQL constructs). Heuristic — false positives ok; recipes can filter.
- **Migration files:** filename patterns (`migrations/<n>-<name>.{sql,ts}`); known frameworks (Knex, Drizzle Kit, Prisma Migrate).

**Recipes unlocked:**

```sql
SELECT * FROM orm_models WHERE framework = 'drizzle';

SELECT * FROM sql_strings WHERE has_concat = 1 AND is_parameterised = 0;

SELECT m.model_name, m.table_name
FROM orm_models m
WHERE m.framework = 'prisma';

SELECT * FROM db_migrations ORDER BY migration_name;
```

New recipe candidates: `sql-injection-audit`; `orm-model-coverage` (which models lack tests?); `unused-db-columns` (column declared in ORM model but not referenced anywhere).

**Effort:** L (~2 weeks). Multiple framework-specific detectors; SQL parsing for safety analysis is non-trivial.

**Dependencies:** Tier 5 (decorators for TypeORM); Tier 1 (positions).

**Tier-specific open questions:**

- (a) Prisma `schema.prisma` requires a separate parser (Prisma DSL, not TS). Worth a `LanguageAdapter` per the existing adapter registry? Probably — separate file kind anyway.
- (b) SQL parsing — full parser (e.g. `node-sql-parser`) or pattern-match? Pattern-match for v1; full parser if `sql-injection-audit` recipe demands it.
- (c) ORM framework coverage — start with Drizzle + Prisma + TypeORM (most common in TS/JS)? Yes. Mongoose / Sequelize / Kysely / Knex as follow-ups.

---

## Sequencing (DAG)

```text
Tier 1 (positions)
  │
  ▼
Tier 2 (references + scopes + bindings)
  ├─────────┬──────────┬──────────┬──────────┬──────────┐
  ▼         ▼          ▼          ▼          ▼          ▼
Tier 3   Tier 4    Tier 5    Tier 9    Tier 10    Tier 11
(JSX)    (Types)   (Behav)   (Tests)   (Markers)  (Metrics)
                                                       │
                                                       ▼
                                                   Tier 13
                                                   (ORM/SQL)

Tier 6 (module-graph enrichment)
  │
  ▼
Tier 12 (module-graph topology)


Tier 7 (CSS richness) — parallel-safe to everything; ship anytime.

Tier 8 (project meta) — parallel-safe; cheapest; ship first or last.
```

**Hard dependencies:**

- Tier 2 depends on Tier 1 (positions to populate `references`).
- Tier 3 depends on Tier 2 (`references` rows for JSX element names).
- Tier 4 depends on Tier 1 (positions for param rewrites).
- Tier 5 depends on Tier 2 (`scope_id`).
- Tier 9 depends on Tier 1 + Tier 2.
- Tier 10 depends on Tier 2 (`scope_id`).
- Tier 11 has no hard deps but Tier 2's `scope_id` enriches some metrics.
- Tier 12 depends on Tier 6 (`files.is_entry`).
- Tier 13 depends on Tier 1 + Tier 5 (decorators for TypeORM).

**Parallel-safe:** Tier 7 (CSS), Tier 8 (project meta) can ship anytime.

**Recommended ship order:**

1. Tier 1 — foundation
2. Tier 2 — foundation (3 weeks)
3. Tier 8 — cheap; ships in parallel with Tier 2
4. Tier 6 — module graph enrichment
5. Tier 11 — metrics; parallel with Tier 6
6. Tier 12 — module-graph topology
7. Tier 3 — JSX
8. Tier 4 — types
9. Tier 5 — behavioral
10. Tier 9 — tests
11. Tier 10 — markers/suppressions
12. Tier 13 — ORM/SQL
13. Tier 7 — CSS (ship anywhere)

---

## Capability matrix — what unlocks post-extraction

Every capability discussed in [`research/codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) — plus everything the "AND MORE" framing extends to:

| Capability                                                                           | Tier(s)                       | Status post-extraction                                                          |
| ------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------- |
| App-wide function rename                                                             | 1 + 2                         | ✅ Full (definition + import + call + re-export + type + decorator + shorthand) |
| Component rename across JSX                                                          | 1 + 2 + 3                     | ✅ Full                                                                         |
| Prop migration on JSX                                                                | 3                             | ✅ Full                                                                         |
| `migrate-deprecated` with replacement map                                            | 1 + 2 + 5                     | ✅ Full                                                                         |
| `fix-boundary-violation`                                                             | existing + 2                  | ✅ Full                                                                         |
| `stale-imports` (specifier-precise delete)                                           | 1                             | ✅ Full                                                                         |
| `dedupe-imports`                                                                     | 1                             | ✅ Full                                                                         |
| `swap-positional-to-named-args`                                                      | 1 + 4                         | ✅ Full                                                                         |
| `add-await-to-async-call`                                                            | 5                             | ✅ Full                                                                         |
| "Find shadowed names"                                                                | 2                             | ✅ Full                                                                         |
| "Find awaits in loops"                                                               | 5                             | ✅ Full                                                                         |
| "Find empty catches"                                                                 | 5                             | ✅ Full                                                                         |
| "Find unconstrained generics"                                                        | 4                             | ✅ Full                                                                         |
| "Find untested public APIs"                                                          | 2 + 9                         | ✅ Full                                                                         |
| "Find tests without assertions"                                                      | 9                             | ✅ Full                                                                         |
| "Find skipped tests"                                                                 | 9                             | ✅ Full                                                                         |
| "Find leftover console.log"                                                          | 10                            | ✅ Full                                                                         |
| "Find debugger statements"                                                           | 10                            | ✅ Full                                                                         |
| "Find import cycles"                                                                 | 12                            | ✅ Full                                                                         |
| "Find dead files by reachability"                                                    | 12 (+ C.9)                    | ✅ Full                                                                         |
| "Find rules with !important"                                                         | 7                             | ✅ Full                                                                         |
| "Find @media queries narrower than 768px"                                            | 7                             | ✅ Full                                                                         |
| "Find unused CSS rules"                                                              | 7 + 3 (JOIN className)        | ✅ Full                                                                         |
| "Find SQL injection risks"                                                           | 13                            | ✅ Full                                                                         |
| "Find ORM model coverage gaps"                                                       | 9 + 13                        | ✅ Full                                                                         |
| "Files using var"                                                                    | 11                            | ✅ Full                                                                         |
| "Refactor risk ranked by complexity + size + coverage"                               | 11 + existing                 | ✅ Full                                                                         |
| "Strict-mode disabled files"                                                         | 8                             | ✅ Full                                                                         |
| "Files missing types field"                                                          | 8                             | ✅ Full                                                                         |
| Cross-file binding-grade rename                                                      | 2 (bindings)                  | ✅ Full                                                                         |
| Path A AST-shape transforms (class→function, JSX rewriting with attribute migration) | Still requires Path B adapter | Path B handles via `ts-morph`                                                   |

The substrate makes nearly every refactor / audit / migration expressible as `query → diff-shape rows → apply`. The engine doesn't grow — recipes consume the richer index. This is Moat A + Moat B working in lockstep: every new capability is a recipe (Moat A); every recipe is JOINs over the richer schema (Moat B).

---

## Operational considerations

### Empirical probe — 2026-05-14

Four real-world fixtures probed with a minimal Tier-2 implementation (`references` table only — every `Identifier` / `JSXIdentifier` / `TSTypeReference` emits a row with line + column + kind). No scope graph, no binding resolution; just the raw extraction-shape cost. The probe is `references` because it's empirically the heaviest single tier (~12-18 rows per symbol; ~3-4× larger than any other planned table). Whatever it costs is the worst-case substrate cost per tier.

| Fixture                        | Files | Symbols | Calls | References | DB baseline | DB w/ refs | Δ DB  | Reindex baseline (median 3 runs) | Reindex w/ refs | Δ reindex | Targeted reindex w/ refs |
| ------------------------------ | ----- | ------- | ----- | ---------- | ----------- | ---------- | ----- | -------------------------------- | --------------- | --------- | ------------------------ |
| A — small CLI/library          | 906   | 11.6k   | 6.6k  | 137k       | 11.4 MB     | 47.6 MB    | +4.2× | ~280 ms                          | ~580 ms         | +2.1×     | ~30 ms                   |
| B — docs-heavy framework       | 1,832 | 8.7k    | 7.2k  | 137k       | 9.7 MB      | 35.2 MB    | +3.6× | ~310 ms                          | ~600 ms         | +2.0×     | ~11 ms                   |
| C — medium TS library monorepo | 1,805 | 26.9k   | 13.6k | 324k       | 17.7 MB     | 80.5 MB    | +4.5× | ~570 ms                          | ~1.30 s         | +2.3×     | not measured             |
| D — enterprise React app       | 2,120 | 28.5k   | 15.6k | 490k       | 37.5 MB     | 158.8 MB   | +4.2× | ~740 ms                          | ~1.94 s         | +2.6×     | ~15 ms                   |

**Observed pattern (4 fixtures, consistent):**

- DB grows **~3.6-4.5×** per tier of this shape (~12-18 identifier rows per symbol; ranges from React-heavy to docs-heavy with no outlier breaking the pattern)
- Full reindex grows **~2-2.6×** per tier — slower than linear in DB size because parse cost dominates the wall-clock; insert cost is amortised via the existing batch-insert helpers
- **Targeted reindex stays flat (~10-30 ms regardless of project size)** — single-file reindex only walks one file's AST + writes its rows; the references-table size doesn't affect single-file insert cost
- Distance from user's "bottleneck" thresholds — largest fixture (D, ~2,100 files / 28k symbols): full reindex at 1.9 s is **31× under** the 1-minute pain threshold; targeted at 15 ms is **66× under** the 1-second pain threshold

### Index size growth (empirical baseline + projection)

| Fixture | Baseline DB | One-tier DB | One-tier growth | All-13-tier projection | All-13-tier growth |
| ------- | ----------- | ----------- | --------------- | ---------------------- | ------------------ |
| A       | 11.4 MB     | 47.6 MB     | +4.2×           | ~60-110 MB             | ~6-10×             |
| B       | 9.7 MB      | 35.2 MB     | +3.6×           | ~50-100 MB             | ~5-10×             |
| C       | 17.7 MB     | 80.5 MB     | +4.5×           | ~90-180 MB             | ~5-10×             |
| D       | 37.5 MB     | 158.8 MB    | +4.2×           | ~190-380 MB            | ~5-10×             |

Multi-tier projection conservative: assumes each subsequent tier adds ~50% of the references-tier cost. Most other tiers add substantially less (positions on existing tables = column additions, not new rows; scope graph + bindings = a few rows per function; JSX / decorators / async-calls / try-catch = far fewer rows per file than identifier references). Real all-13-tier growth likely lands at the lower end (~5×) for most projects.

Per [R.9](#pre-locked-decisions): no hard size ceiling. Per [R.3](#pre-locked-decisions): tier-level opt-out via `.codemap/config.{ts,js,json}` `extraction: { references: false }` recovers ~75% of growth on monorepos that don't need cross-file identifier rename.

### Reindex performance (empirical baseline + projection)

| Fixture | Baseline full | One-tier full | One-tier slowdown | All-13-tier projected full | Targeted (w/ refs) |
| ------- | ------------- | ------------- | ----------------- | -------------------------- | ------------------ |
| A       | ~280 ms       | ~580 ms       | +2.1×             | ~1-2 s                     | ~30 ms             |
| B       | ~310 ms       | ~600 ms       | +2.0×             | ~1-2 s                     | ~11 ms             |
| C       | ~570 ms       | ~1.30 s       | +2.3×             | ~3-5 s                     | (not measured)     |
| D       | ~740 ms       | ~1.94 s       | +2.6×             | ~4-6 s                     | ~15 ms             |

Targeted reindex stays sub-50 ms across the entire fixture range — only the touched file + its binding closure recompute. Full reindex is bounded by parse cost (oxc walks every file's AST); the per-tier multiplier comes from incremental SQLite insert work + larger in-flight `ParsedFile` messages between worker → main thread. All-13-tier full reindex stays well under the user's 1-minute threshold for projects up to ~5,000 files / 50k symbols.

Per [R.10](#pre-locked-decisions): soft warn when full > 30 s OR targeted > 500 ms. Both far above the measured worst case.

### Config opt-out shape

```ts
import { defineConfig } from "@stainless-code/codemap";

export default defineConfig({
  extraction: {
    references: true,
    jsx: true,
    types: true,
    behavioral: true,
    moduleGraph: true,
    css: true,
    projectMeta: true,
    tests: true,
    runtimeMarkers: true,
    metrics: true,
    moduleTopology: true,
    orm: false,
  },
});
```

Defaults to all-on. Each tier's extractor checks its flag at parse-worker startup and no-ops if disabled.

### Worker-thread shape

`ParsedFile` message grows ~10× in size. Worker IPC handles this fine. Worker concurrency unchanged (one worker per CPU core, file-parallel).

### Cross-file binding resolution

Pass 2 (main thread) walks `references` rows and resolves `bindings`. Implementation:

- For each file: load same-file `symbols` + cross-file `imports` into in-memory maps once.
- For each `references` row: scope-walk for same-file; then check `imports`; then re-export chain.
- Batch-insert resolved `bindings` rows.

Expected pass-2 cost: ~30% of total reindex time on large projects.

---

## What's NOT in scope

Two genuinely-unindexable categories. Worth naming so the strategy is explicit.

1. **Runtime / dynamic behavior.** `obj[computedName]` member access; `Function` constructor; `eval`; runtime-computed import paths (`import(\`./modules/\${name}\`)`); macros / build-time codegen output. The index captures the AST shape; resolution happens at runtime. Recipes touching these stay conservative — same caveat as `rename-preview`'s "What v1 does not cover" section.

2. **Cross-tree type resolution.** `tsserver`-grade type evaluation — what does this type resolve to after all conditional/mapped/inferred type operators? We extract type-text as written, not as resolved. For type-level queries (`is this generic instantiated with X?`; `does this satisfy that interface?`), Path B adapter via `ts-morph` is the answer — same as for AST-shape rewrites. The substrate gives recipes the structural facts; type-level semantics belong to the language service.

Everything else the user could plausibly query at AST-shape granularity is in the 13 tiers above.

---

## Lifecycle

Per [`docs-governance § Closing a plan`](../../.agents/skills/docs-governance/SKILL.md#closing-a-plan):

- **When all 13 tiers ship:** lift the durable bits — `architecture.md § Schema` documents the full table catalog; `glossary.md` gains entries for `references` / `bindings` / `scopes` / `jsx_elements` / `function_params` / `decorators` / `jsdoc_tags` / `test_suites` / `orm_models` / etc. Delete this plan file.
- **If a tier is rejected mid-plan:** `Status: Rejected (date) — <reason>` on the tier's section; rest of the plan continues.
- **If a tier is deferred:** stays in-plan with no status; not on the active sequence.

Plan-PR-shape per [`plan-pr-inspiration-discipline`](../../.agents/rules/plan-pr-inspiration-discipline.md): every schema delta cites the primitive source it draws from (oxc, Lightning CSS, SQLite docs, LSP) — see § 10.

---

## Primitive sources + internal cross-references

### Primitive sources

| Source                                                                                                                                                                | Tiers that draw from it                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [oxc parser](https://oxc.rs) — AST node reference, visitor API                                                                                                        | 1, 2, 3, 4, 5, 9, 10, 11, 13                          |
| [Lightning CSS](https://lightningcss.dev/) — visitor API, selector parsing, specificity                                                                               | 7                                                     |
| [SQLite docs § STRICT tables](https://www.sqlite.org/stricttables.html)                                                                                               | All tiers (schema discipline)                         |
| [SQLite docs § FTS5](https://www.sqlite.org/fts5.html)                                                                                                                | 2 (Q12 — `references.name` FTS integration)           |
| [SQLite docs § Recursive CTE](https://www.sqlite.org/lang_with.html)                                                                                                  | 6 (re-export chains), 12 (graph traversal)            |
| [TC39 ECMA-262](https://tc39.es/ecma262/) — language-level shapes                                                                                                     | 2, 4, 5 (await, try/catch, decorators)                |
| [LSP `Location`](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#location)                                                | 1 (column-precise positions); 5 (decorator positions) |
| [Tarjan's strongly-connected components algorithm](https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm)                                  | 12                                                    |
| Test framework specs ([Vitest](https://vitest.dev/), [Jest](https://jestjs.io/), [`node:test`](https://nodejs.org/api/test.html))                                     | 9                                                     |
| [Prisma schema reference](https://www.prisma.io/docs/orm/reference/prisma-schema-reference), [Drizzle ORM](https://orm.drizzle.team/), [TypeORM](https://typeorm.io/) | 13                                                    |

### Internal anchors

- [`research/codemap-richer-index-synthesis-2026-05.md`](../research/codemap-richer-index-synthesis-2026-05.md) — the write-engine direction this substrate unlocks
- [`roadmap.md § Moats`](../roadmap.md#moats-load-bearing) — Moat B is the load-bearing axis ("Extracted structure ≥ verdicts")
- [`roadmap.md § Floors`](../roadmap.md#floors-v1-product-shape) — preserved: no JS execution at index time; no opinionated rule engine
- [`architecture.md § Schema`](../architecture.md#schema) — current schema documentation; grows substantially with each tier's PR
- [`architecture.md § Full rebuild (parallel)`](../architecture.md#full-rebuild-parallel) — worker-pool architecture this plan extends
- [`glossary.md`](../glossary.md) — every new schema concept gets a glossary entry on tier ship
- [`docs/plans/c9-plugin-layer.md`](./c9-plugin-layer.md) — Tier 12 collaborates with C.9 (`files.is_entry`); Tier 12 ships its own reachability via heuristic entry detection if C.9 lands later
- [`docs/plans/lsp-diagnostic-push.md`](./lsp-diagnostic-push.md) — every tier sharpens LSP diagnostic precision; the substrate is shared

### Adjacent skills + rules

- [`docs-governance` skill](../../.agents/skills/docs-governance/SKILL.md) — plan-PR lifecycle
- [`tracer-bullets`](../../.cursor/rules/tracer-bullets.mdc) — each tier is one tracer-bullet PR; never build all 13 in isolation
- [`plan-pr-inspiration-discipline`](../../.cursor/rules/plan-pr-inspiration-discipline.mdc) — primitive-source citations (§ 10 above)
- [`audit-pr-architecture`](../../.agents/skills/audit-pr-architecture/SKILL.md) — every tier PR should pass moat / boundary checks
- [`codemap.mdc`](../../.cursor/rules/codemap.mdc) — Moat A reviewer test: every new table / column must be queryable via SQL, never wrapped in a CLI verb
- [`agents-tier-system`](../../.agents/rules/agents-tier-system.md) — plan respects durability rules (no source-line citations; symbol references and design intent only)
