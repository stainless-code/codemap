# Substrate extraction — maximal AST → SQLite enrichment plan

> **Status:** open (tiers **7–8**, **13**) · tiers **1–6** shipped · tiers **9–12** partial — live tables and `SCHEMA_VERSION` in [`architecture.md § Schema`](../architecture.md#schema) / [`src/db.ts`](../../src/db.ts). Apply executor + eight diff-shape recipes shipped — [`architecture.md § Apply`](../architecture.md#apply--input-modes-transport-and-policy).
>
> **Per-tier ship status (fact-checked 2026-06; `SCHEMA_VERSION` 40):** Tiers **1–6** shipped. Tier headings carry the PR landing date for that slice; the remainder wave closed **2026-05-19** (tiers 1–6 foundation landed **2026-05-14**–**15**). Tier **1**: call-shape columns, side-effect `import_specifiers` + `import_id`. Tier **2**: `bindings.resolution_kind='re-exported'`. Tier **3**: `jsx_elements` / `jsx_attributes`. Tier **5**: `async_calls`, `try_catch`, `decorators`, `jsdoc_tags`. Tier **4** partial: `symbols.{return_type,is_async,is_generator}` + `function_params`; `generic_params` / `type_predicates` deferred. Tier **6** partial: `dynamic_imports`, `files.{is_barrel,has_side_effects}`; `files.is_entry` deferred to [`c9-plugin-layer.md`](./c9-plugin-layer.md). Tiers **9–12** partial; **7–8** + **13** open.
>
> **Motivator:** Codemap's distinctive value is the SQL-against-structural-index substrate. Per [Moat B](../roadmap.md#moats-load-bearing) — _"Extracted structure ≥ verdicts. Schema breadth is the substrate every recipe layers on."_ — the load-bearing growth axis is **what oxc / Lightning CSS / config loaders give us that the index doesn't yet expose.** Tiers **1–6** shipped: position-precise calls/imports/exports, `references` / `scopes` / `bindings`, JSX, behavioral facts, module-graph flags, and more — see [architecture § Schema](../architecture.md#schema). **Open tiers 7–8 + 13** below enumerate CSS rule depth, project meta, ORM/SQL tracking, and other AST surfaces we discard at parse time today. Each remaining tier ships as an independent tracer-bullet PR that compounds into a maximal substrate.
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

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Source                                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R.1  | **Single-pass extraction.** All tier extractors run in one oxc walk per file. No multi-pass over the same AST. Visitor-mode extractors register callbacks per node type; the walk is shared. Performance and correctness — one tree-walk per file is the cheapest contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | oxc Visitor API; existing `extractFileData` in `parser.ts`                                                                                                             |
| R.2  | **Additive schema.** All new substrate is new columns on existing tables OR new tables linked via foreign key. Existing recipes don't break. Schema version bumps trigger one-shot reindex on consumer upgrade (per current `SCHEMA_VERSION` pattern).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Existing `SCHEMA_VERSION` reconciliation in `db.ts` + [`architecture.md`](../architecture.md) schema §                                                                 |
| R.3  | **Tier-independent extractors.** Proposed capability: each tier's extractor can be enabled / disabled via `.codemap/config.{ts,js,json}` `extraction.<tier>: false`. **Status 2026-05-18:** not implemented; current config has `fts5`, `recipeRecency`, and `boundaries`, but no `extraction` object.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Defensive — keeps the substrate growth path opt-out-friendly per the existing `fts5: true` / `boundaries: …` config patterns                                           |
| R.4  | **Bindings cascade on file change.** Incremental reindex of file X invalidates `references` + `bindings` + `scopes` rows for X; recomputes them. Other files' bindings to symbols defined in X don't auto-invalidate on incremental — full rebuild or targeted reindex of dependents is required (no lazy recompute on read). Acceptable staleness for the common case (consumer edits implementation; consumers' references still resolve correctly until name change).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | SQLite cascade semantics; `ON DELETE CASCADE` already used pervasively                                                                                                 |
| R.5  | **Position convention.** Lines 1-indexed, columns 0-indexed (byte offsets within line). Matches existing `line_number` / `line_start` convention and oxc's native offset format. Mismatched conventions inside one row are a silent foot-gun.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | oxc emits byte offsets; existing `offsetToLine` already converts                                                                                                       |
| R.6  | **Column-precise = identifier-token-precise.** `column_start` / `column_end` are the byte offsets of the actual name / element token, NOT the containing expression's offsets. So `foo()` records `column_start` = position of `foo`, `column_end` = position after `o`, not after `)`. Matches what a rename engine wants.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | LSP `Location` convention; same as `tsserver`'s reference response                                                                                                     |
| R.7  | **Recipes own visibility.** New extracted facts are queryable substrate; recipes decide what to surface as findings / fixes / actions. No bare verdicts at extraction time. Same discipline as `audit verdict` defer per [roadmap backlog](../roadmap.md#backlog).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | [Moat A](../roadmap.md#moats-load-bearing) — verdicts are output mode                                                                                                  |
| R.8  | **No JS execution at extract time.** oxc parses; we walk; we record. Same floor as today's index. No `eval`, no dynamic resolution, no LLM in the box.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | [Floors "No JS execution at index time"](../roadmap.md#floors-v1-product-shape)                                                                                        |
| R.9  | **No hard size ceiling; soft warn at >5× DB growth.** Empirical measurement on four real fixtures with a minimal `references`-only probe (one of the heaviest single tiers in isolation) showed consistent ~3.6-4.5× DB growth at one tier. Projecting all 13 tiers conservatively: ~5-10× growth. SQLite handles 200-500 MB DBs trivially. Users hitting pain on large monorepos opt out of expensive tiers via R.3 — that's the safety valve, not a global ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Measured 2026-05-14, four fixtures spanning ~900-2,100 files (see § Operational considerations § Index size growth)                                                    |
| R.10 | **Latency budget tied to user-visible operations, not DB size.** Soft warn when full reindex > 30s OR targeted reindex > 500ms. Measured worst-case (one tier, largest fixture ~2,100 files / 28k symbols): full ~1.9s, targeted ~15ms. Both ~10-60× under the user-stated bottleneck threshold (1 min full / sub-second targeted). Full 13-tier projection still well under budget.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Measured 2026-05-14 (see § Operational considerations § Reindex performance)                                                                                           |
| R.11 | **Hand-rolled scope walker in the existing oxc visitor.** No library dep. `oxc-parser` explicitly doesn't construct scopes; no NAPI binding for `oxc-semantic` yet. Existing `scopeStack` in `parser.ts` (used for cyclomatic complexity + call-site scope) extends to a full scope graph. Edge cases (TS namespace merge, declaration hoisting, TDZ) handled conservatively. **Status 2026-05-19:** the shipped `bindings.resolution_kind` enum is `same-file` / `imported` / `re-exported` / `global` / `unresolved`; the originally proposed `ambiguous` escape valve did not ship.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | oxc-parser's `showSemanticErrors` doc explicitly says "the parser does not construct symbols and scopes"; existing `scopeStack` infrastructure in `parser.ts`          |
| R.12 | **Pre-resolve `bindings` at index time (two-pass).** Pass 1 (per file, in worker): extract refs, scopes, local declarations. Pass 2 (main thread, after all files parsed): walk `references` rows; resolve via same-file scope-walk → `imports` → `exports` → re-export chain; populate `bindings`. Same architecture as today's `resolver.ts` two-pass for `dependencies`. Cost: ~25-50% on top of refs-only reindex (projected worst case ~3-4s full on the largest fixture; well under R.10 budget). Recipes get a single-JOIN `bindings → symbols` instead of recursive-CTE-per-recipe. R.4 cascade extends: single-file reindex deletes that file's `bindings` rows AND any binding referencing symbols in that file.                                                                                                                                                                                                                                                                                                                                                                                       | Existing `resolver.ts` two-pass pattern; `dependencies` table as precedent                                                                                             |
| R.13 | **`references.is_write` distinguishes reads from writes.** Boolean column populated by parent-node-shape check during the visitor pass (`AssignmentExpression.left`, `UpdateExpression`, `delete`, `AssignmentPattern`, `VariableDeclarator.id` with initializer, `ForOfStatement.left`, `ForInStatement.left`). Compound assignment (`x += 1`) emits TWO `references` rows — one with `is_write = 0` (the read) and one with `is_write = 1` (the write) — at the same `(file_path, line_start, column_start)`. Substrate honesty: recipes that want a single-row-per-position can `SELECT DISTINCT`. Unlocks immutability audits, side-effect detection, cross-file mutation tracking.                                                                                                                                                                                                                                                                                                                                                                                                                          | Cost trivial (one column + ~10 lines of visitor logic); recipe-unlock substantial (no other way to express "find writes to X" without external AST walk)               |
| R.14 | **FTS5 stays file-content-only.** New substrate tables (`references`, `jsx_elements`, `function_params`, `decorators`, `test_suites`, …) are NOT indexed via FTS5 by default. Every `name` / identifier column gets a regular B-tree index, which covers exact match + anchored prefix (`LIKE 'use%'` / `GLOB 'use*'`) at O(log N). FTS5 only helps unanchored substring search; the row counts at every tier remain small enough (~10-500k) that an unanchored `LIKE '%foo%'` scan still completes in tens of milliseconds. Cost saved: ~25-90 MB of FTS5 storage per project across all 13 tiers. Per-tier opt-in path: a tier PR can add FTS5 on its own table when a concrete recipe requires unanchored search — schema-additive, no breaking change.                                                                                                                                                                                                                                                                                                                                                       | Existing `source_fts` keeps its current shape (file-content full-text); empirical row-count + B-tree-index-perf argument; substrate stays lean                         |
| R.15 | **Tier-level opt-out via `.codemap/config` `extraction: { … }`; human-readable feature names; Tier 1 always on; `orm` default-off, others default-on.** Config keys are capability-shaped (`references`, `jsx`, `types`, `behavioral`, `moduleGraph`, `css`, `projectMeta`, `tests`, `runtimeMarkers`, `metrics`, `moduleTopology`, `orm`) — never tier numbers or table names. **Status 2026-05-18:** proposed only; `codemapUserConfigSchema` has no `extraction` object today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Matches user's mental model (capabilities, not tables); existing config patterns are single-flag-per-feature (`fts5: true`, `boundaries: […]`, `recipeRecency: false`) |
| R.16 | **Every rebuild-forcing tier bumps `SCHEMA_VERSION`; full rebuild on mismatch; no in-place migrations.** Existing schema-mismatch logic (`createSchema()` wrapping `dropAll()` + `createTables()` + `createIndexes()`) handles rebuild-forcing upgrades transparently. User-data tables (`coverage`, `query_baselines`, `recipe_recency`) stay protected via the existing `dropAll()` exclusion list; config-derived `boundary_rules` is intentionally rebuilt, not preserved. Empirical worst case across measured fixtures: full rebuild ~2s on a 28k-symbol enterprise app. Reject in-place `ALTER TABLE` migration scripts until concrete demand emerges.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Empirical rebuild cost (R.10); existing `dropAll()` exclusion list protects user data while derivable/config data rebuilds                                             |
| R.17 | **Extractor modules (`src/extractors/*.ts`) are partially shipped, but not the proposed per-tier registry.** Current source has dedicated extractor helpers and `parser.ts` is smaller than the original monolith, but extractors still run through the existing parser orchestration and are not filtered through `cfg.extraction[tierId]`. Future tier PRs should extend the existing extractor module layout instead of assuming the proposed `register(visitor, ctx)` API exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Existing extractor modules + `parser.ts`; `LanguageAdapter` pattern in `src/adapters/builtin.ts` remains the precedent for first-class pluggable units                 |
| R.18 | **Every tier PR ships ≥1 flagship recipe + golden fixture.** Definition-of-Done for every tier PR: (a) substrate (schema + extractor + extractor tests); (b) **one bundled recipe** under `templates/recipes/<id>.{sql,md}` exercising the new substrate via real JOIN paths; (c) **one golden fixture** under `fixtures/golden/<recipe-id>.json` so the recipe is regression-tested in CI. Flagship recipe designated in the tier's plan section (currently lists 3-7 "Recipes unlocked" candidates — one gets marked "flagship" per tier). Additional candidate recipes bundle in same PR if cheap, or ship as follow-ups at author discretion. Extension recipes (e.g. Tier 5's `calls.{line_start, column_start}` letting `rename-preview` grow a `call_rows` CTE) ship in the same PR as their substrate. Validates substrate at ship time; catches schema-shape mistakes via real query exercise; honors Moat A reverse-test ("if we remove this column, what recipe dies?"). Avoid hardcoding recipe counts; derive the current catalog from `templates/recipes/*.sql` or `codemap query --recipes-json`. | Moat A's reviewer test demands substrate be queryable                                                                                                                  |

---

## Open decisions

Each gets a "Resolution" subsection below as it crystallises (mirrors `lsp-diagnostic-push.md` pattern). Numbered for stable citation from future plan PRs.

- **Q1 — `references` resolution strategy.** **RESOLVED 2026-05-14 — promoted to [R.11](#pre-locked-decisions).** Hand-rolled scope walker in existing oxc visitor; no library dep; reuses single-pass extraction. The shipped conservative fallback is `resolution_kind = 'unresolved'`; the originally proposed `ambiguous` enum value did not ship.

- **Q2 — Multi-file binding resolution.** **RESOLVED 2026-05-14 — promoted to [R.12](#pre-locked-decisions).** Pre-resolve at index time (two-pass), same architecture as today's `resolver.ts`. Pays the cost once at index time; recipes get cheap single-JOIN access.

- **Q3 — Type-text stringification fidelity.** Today `symbols.signature` stringifies types via `stringifyTypeNode`. Tier 4 extends to per-param + per-generic + return-type + predicate-target. Same stringification approach? Or shift to a richer normalized form (canonicalize whitespace; sort union members; etc.)? Plan PR for Tier 4 settles.

- **Q4 — JSX element parent linking.** `jsx_elements.parent_element_id` requires either second pass (after the entire tree is parsed) or order-of-emit guarantee (parent visited before children with stable IDs). oxc walks top-down by default; record IDs eagerly and link in a post-emit pass within the same parser invocation.

- **Q5 — Loop / try / scope context tracking.** Walking the AST top-down — how does `async_calls.in_loop` know it's inside a loop? Maintain a context stack (push on enter ForStatement/WhileStatement/etc., pop on exit). Same for `in_try` / `in_async_fn`. Visitor state shape settles in Tier 5 PR.

- **Q6 — Decorator target resolution.** Decorators in source appear BEFORE the symbol they decorate. Resolution requires post-pass linking — record decorator nodes with their position, then link to the following ClassDeclaration / MethodDefinition / PropertyDefinition once visited. Same pattern as Q4.

- **Q7 — JSDoc tag schema.** Free-form `description` text per tag, OR structured per-tag-shape (each `@param` parsed into `name` + `type_text` + `description`)? Bias toward structured — query power is the point. Settle in Tier 5 PR.

- **Q8 — Test-framework detection.** `describe` / `it` / `test` are global functions in test files. Detect by: (a) config glob (`test: ['**/*.test.ts', '**/*.spec.ts']`); (b) file extension match (`.test.`, `.spec.`); (c) import-presence check (`from 'vitest'` / `'@jest/globals'` / `'node:test'`). Bias toward (b) + (c) — file extension as cheap default; import-presence as strong signal.

- **Q9 — Index size budget.** **RESOLVED empirically 2026-05-14 — promoted to [R.9](#pre-locked-decisions).** Four-fixture probe (one tier, references-only). DB grows ~4× at one tier; projected ~5-10× at full 13 tiers. No hard ceiling; per-tier opt-out (R.3) is the safety valve. Summary in [§ Operational considerations](#operational-considerations); full tables in `git log --follow`.

- **Q10 — Reindex performance regression.** **RESOLVED empirically 2026-05-14 — promoted to [R.10](#pre-locked-decisions).** Full reindex ~2-2.6× slower at one tier; targeted reindex stays flat (~10-30ms regardless of project size). Largest fixture measured: ~1.9s full / 15ms targeted. Summary in [§ Operational considerations](#operational-considerations); full tables in `git log --follow`.

- **Q11 — Per-tier opt-out shape.** **RESOLVED 2026-05-14 — promoted to [R.15](#pre-locked-decisions).** Tier-level opt-out with capability-shaped names; Tier 1 always on; `orm` default-off; others default-on.

- **Q12 — FTS5 integration.** **RESOLVED 2026-05-14 — promoted to [R.14](#pre-locked-decisions).** FTS5 stays file-content-only; new substrate columns get regular B-tree indexes; per-tier opt-in path stays open for concrete recipe demand.

- **Q13 — Worker-thread message shape.** Today `parse-worker.ts` emits one `ParsedFile` message per file. With many tiers, that message becomes large (~10-20KB per file → ~100-200KB). Worker IPC handles this fine; no architectural change needed but plan PR confirms.

- **Q14 — In-place schema migration.** **RESOLVED 2026-05-14 — promoted to [R.16](#pre-locked-decisions).** Every tier bumps `SCHEMA_VERSION`; full rebuild on mismatch; reject in-place migrations. Empirical rebuild cost (~2s worst case) makes optimisation unjustified.

- **Q16 — Extractor-registration architecture.** **RESOLVED 2026-05-14 — decision locked in [R.17](#pre-locked-decisions).** Target shape is per-tier modules under `src/extractors/<tier>.ts`; **not implemented** as the `TierExtractor { register(visitor, ctx) }` registry — extend today's extractor layout per R.17. (Question added during the grill — not in the original Q1-Q15 numbering.)

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

Per R.2 + Q14: bump `SCHEMA_VERSION` only when a tier's DDL forces a rebuild; additive tables / columns can land through `CREATE ... IF NOT EXISTS`. The first time a user hits a rebuild-forcing schema change, the index drops and rebuilds. ~30s on a 100k-symbol project; one-time cost.

Alternative for advanced users: a future `codemap migrate --in-place` command runs additive `ALTER TABLE` for new columns + extracts new tables from existing files without re-parsing. Defer until cheap-migration demand surfaces.

### Worker-thread integration

Per Q13: today's `parse-worker.ts` emits `ParsedFile`. Extend the message shape additively — new fields per tier; existing fields unchanged. Workers don't need new IPC infrastructure; only the message-shape contract grows.

### Index sizing expectations (empirical projection from 2026-05-14 probe)

One-tier projection (extrapolated from the references-only probe; see [§ Operational considerations](#operational-considerations)) holds steady at ~4× DB growth. Multi-tier projection assumes additive cost across tiers — most other tiers extract substantially less data than `references` (positions on existing tables, scope graph, JSX attributes, etc. each add far fewer rows). Conservative multi-tier estimate: ~5-10× growth across all 13 tiers.

| Project size (measured)                | Pre-extraction DB | All-13-tier projected DB | Pre-extraction reindex | All-13-tier projected reindex |
| -------------------------------------- | ----------------- | ------------------------ | ---------------------- | ----------------------------- |
| Small (~900 files, 11k symbols)        | ~11 MB            | ~60-110 MB               | ~280 ms                | ~1-2 s                        |
| Medium-docs (~1.8k files, 8k symbols)  | ~10 MB            | ~50-100 MB               | ~310 ms                | ~1-2 s                        |
| Medium-code (~1.8k files, 27k symbols) | ~18 MB            | ~90-180 MB               | ~570 ms                | ~3-5 s                        |
| Large-app (~2.1k files, 28k symbols)   | ~38 MB            | ~190-380 MB              | ~740 ms                | ~4-6 s                        |

All four projections sit well under the [Floors](../roadmap.md#floors-v1-product-shape)-relevant "codemap becomes a bottleneck" thresholds the user set (full > 1 min, targeted > 1 s). Accept the growth — the database is the product. The proposed `extraction` config would let monorepo users opt out of expensive tiers, but that config surface is not implemented today.

---

## The 13 tiers

Each tier is one tracer-bullet PR: parser visitor change + schema migration + 1-2 example recipes + tests + docs entry. Sections below capture: **Goal** (one sentence), **Schema delta** (DDL), **Visitor strategy** (key extraction logic), **Recipes unlocked** (example queries + new recipe candidates), **Effort** (S/M/L with week estimate), **Dependencies** (other tiers that must ship first), **Tier-specific open questions**.

### Tier 1 — Position precision on existing tables — **SHIPPED 2026-05-14**

**Canonical home:** [`architecture.md` § Schema](../architecture.md#schema). Slices 1.A–1.D landed 2026-05-14–19.

**Shipped:** `calls.{line_start,column_*,args_count,is_method_call,is_constructor_call,is_optional_chain}`; `exports` position columns + `is_re_export`; `symbols`/`markers` column anchors; `import_specifiers` child table (`import_id` nullable for side-effect rows).

**Flagship recipes:** `find-call-sites`, `find-export-sites`, `find-symbol-definitions`, `find-import-sites`.

### Tier 2 — `references` + `scopes` + `bindings` — **SHIPPED 2026-05-15**

**Canonical home:** [`architecture.md` § Schema](../architecture.md#schema).

**Shipped:** `references` (`kind` value/type/jsx/member), `scopes`, `bindings` (`resolution_kind` same-file/imported/re-exported/global/unresolved). ~1.3% unresolved on codemap-self at ship.

**Flagship recipes:** `rename-preview` binding CTEs, `find-symbol-references`, scope-aware queries.

### Tier 3 — JSX elements + attributes — **SHIPPED 2026-05-19**

**Canonical home:** [`architecture.md` § Schema](../architecture.md#schema).

**Shipped:** `jsx_elements`, `jsx_attributes`; `references.kind='jsx'` for identifier sites. Flagship: `find-jsx-usages`, `migrate-jsx-prop`.

**Deferred:** full app-wide JSX rename beyond current recipe extensions.

### Tier 4 — Type / signature depth — **PARTIAL (2026-05-15)**

**Shipped:** `symbols.{return_type,is_async,is_generator}`.

**Shipped:** `function_params` child table. **Open:** `generic_params`, `type_predicates` — full spec in `git log --follow` if a recipe needs UNION across param tables.

### Tier 5 — Behavioral facts — **SHIPPED 2026-05-19**

**Canonical home:** [`architecture.md` § Schema](../architecture.md#schema).

**Shipped:** `async_calls`, `try_catch`, `decorators`, `jsdoc_tags` tables + flagship behavioral recipes.

### Tier 6 — Module-graph enrichment — **PARTIAL (2026-05-19)**

**Shipped:** `dynamic_imports`, `re_export_chains` (`from_file`/`from_name`/`to_file`/`to_name`), `files.{is_barrel,has_side_effects}` (AST top-level side effects only — **not** `package.json` `sideEffects` field; that is Tier 8).

**Deferred:** `files.is_entry` → [`c9-plugin-layer.md`](./c9-plugin-layer.md).

### Tier 7 — CSS richness (rules, at-rules, declarations)

**Ship status (2026-05-15):** Not shipped. `css_rules` / `css_at_rules` / `css_declarations` absent from [`src/db.ts`](../../src/db.ts) (existing `css_classes` / `css_variables` / `css_keyframes` unchanged). Open; parallel-safe per § Sequencing.

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

**Ship status (2026-05-15):** Not shipped. `tsconfig_options` / `package_json_meta` absent from [`src/db.ts`](../../src/db.ts). Open; parallel-safe per § Sequencing.

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

### Tier 9 — Test-suite metadata — **PARTIAL (2026-05-15)**

**Shipped:** `test_suites` table + test-oriented recipes. **Open:** assertion/skip metadata depth per original tier spec.

### Tier 10 — Lint suppressions + runtime/dev markers — **PARTIAL (2026-05-15)**

**Shipped:** `runtime_markers`, `suppressions` (narrower enum than original proposal). **Open:** full suppression-rule substrate.

### Tier 11 — Metrics expansion — **PARTIAL (2026-05-15)**

**Shipped:** `file_metrics` + per-symbol metric columns (see [`glossary.md`](../glossary.md)). **Shipped:** `file_churn` + **`churn-complexity-hotspots`** recipe (see [architecture § `file_churn`](../architecture.md#file_churn--git-churn-metrics-per-indexed-file-strict)).

### Tier 12 — Module-graph topology — **PARTIAL (2026-05-15)**

**Shipped:** `module_cycles` (Tarjan SCC). **Open:** `module_graph_facts`, reachability beyond cycles.

### Tier 13 — ORM / SQL string tracking

**Ship status (2026-05-15):** Not shipped. `orm_models` / `sql_strings` / `db_migrations` absent from [`src/db.ts`](../../src/db.ts). Open; `orm` extraction stays default-off per R.15.

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

- **ORM detection:** look for known patterns — Prisma model file (`schema.prisma` — separate parser); Drizzle `sqliteTable('foo', {...})` / `pgTable('foo', {...})` calls; TypeORM `@Entity` decorator (links to Tier 5 decorators); Mongoose `mongoose.Schema(...)` calls.
- **SQL strings:** tagged template literals like `` sql`SELECT ...` ``; raw string literals containing SQL-keyword sequences (`SELECT`, `INSERT`, `UPDATE`, `DELETE` followed by known SQL constructs). Heuristic — false positives ok; recipes can filter.
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
- Tier 12 optionally enriched by C.9 (`files.is_entry` — deferred to [`c9-plugin-layer.md`](./c9-plugin-layer.md)); ships heuristic entry detection without it.
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

Recipe-level capability inventory lives in [`architecture.md` § Schema](../architecture.md#schema) + `templates/recipes/`. This plan owns **open-tier** unlock paths (7–8, 13) and R.1–R.18 decisions. Shipped-tier recipe map: grep `templates/recipes/*.sql` or `codemap query --recipes-json`.

| Capability class                              | Status                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| Position-precise rename / import / call edits | **Shipped** (tiers 1–2 + apply path)                        |
| JSX / behavioral / module-graph flags         | **Shipped** (tiers 3–6 partial)                             |
| Test / marker / metrics / cycles substrate    | **Partial** (tiers 9–12)                                    |
| CSS rule depth, project meta, ORM/SQL         | **Open** (tiers 7–8, 13)                                    |
| Entry-point reachability                      | **Deferred** → [`c9-plugin-layer.md`](./c9-plugin-layer.md) |

## Operational considerations

Empirical probes (2026-05-14, four fixtures): ~4× DB growth at one heavy tier; full reindex ~2s worst-case on 2.1k-file app; targeted ~15ms. Soft budgets: R.9 (no hard size ceiling; per-tier opt-out when R.3 lands), R.10 (warn full >30s / targeted >500ms). Full measurement tables: `git log --follow -- docs/plans/substrate-extraction.md`.

## What's NOT in scope

Two genuinely-unindexable categories. Worth naming so the strategy is explicit.

1. **Runtime / dynamic behavior.** `obj[computedName]` member access; `Function` constructor; `eval`; runtime-computed import paths (``import(`./modules/${name}`)``); macros / build-time codegen output. The index captures the AST shape; resolution happens at runtime. Recipes touching these stay conservative — same caveat as `rename-preview`'s "What v1 does not cover" section.

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

- [`architecture.md` § Apply](../architecture.md#apply--input-modes-transport-and-policy) — shipped write-engine executor + rejected-alternative table
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
