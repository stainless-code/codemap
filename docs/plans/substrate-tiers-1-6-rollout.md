# Substrate tiers 1–6 rollout (without C.9)

> **Status:** Complete — implemented on `feat/substrate-tiers-1-6` (8 commits, `SCHEMA_VERSION` 27→**34**). C.9 explicitly excluded. Push + draft PR when ready (body below).
> **Parent plan:** [`substrate-extraction.md`](./substrate-extraction.md) (tiers 7–13 out of scope here).  
> **Explicit exclusion:** C.9 plugin layer — no `files.is_entry`, no reachability-from-entry, no framework entry hints. See [`c9-plugin-layer.md`](./c9-plugin-layer.md).

## Baseline (codemap-validated 2026-05-19)

Reindexed self (`bun src/index.ts --full`); `validate --json` → `[]`.

| Fact                       | Value                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCHEMA_VERSION`           | **34** ([`src/db.ts`](../../src/db.ts))                                                                                                                                                     |
| Extractor orchestration    | [`src/parser.ts`](../../src/parser.ts) `EXTRACTORS[]` — … `referencesExtractor` → `jsxExtractor` → `dynamicImportsExtractor` → `behavioralExtractor` → `moduleSideEffectsExtractor` → …     |
| Post-passes (index-engine) | bindings, re-export chains, module cycles, JSX parent links (per-file insert), decorator/jsdoc symbol linking                                                                               |
| Live substrate tables      | All tier 1–6 rollout tables including `jsx_*`, `async_calls`, `try_catch`, `decorators`, `jsdoc_tags`, `dynamic_imports`, enriched `calls`/`symbols`/`import_specifiers`/`bindings`/`files` |
| Absent (in-scope gaps)     | C.9 only (`files.is_entry`, reachability). Tiers 7–13 out of scope.                                                                                                                         |

Codemap impact on call extraction touch chain: `src/extractors/calls.ts` → `src/parser.ts` → `src/application/index-engine.ts` → `src/db.ts`.

## Scope summary

| Tier  | Shipped today                                                                                                         | This rollout closes                                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Positions on `calls`/`exports`/`symbols`/`markers`; `import_specifiers` (no `import_id`; side-effect imports skipped) | `calls.{args_count,is_method_call,is_constructor_call,is_optional_chain}`; optional slice 1.B: side-effect import rows + `import_id` FK |
| **2** | `references`/`scopes`/`bindings`/`function_params`/`re_export_chains`; narrowed kinds                                 | `resolution_kind='re-exported'` in bindings pass; optional reference-kind expansion deferred                                            |
| **3** | Component heuristic only (`components` table)                                                                         | `jsx_elements` + `jsx_attributes` (new extractor module)                                                                                |
| **4** | `function_params` (owner-keyed, not `symbol_id` FK)                                                                   | `symbols.{return_type,is_async,is_generator}`; defer `generic_params`/`type_predicates`/`throws_clauses` tables                         |
| **5** | Nothing                                                                                                               | Tracer bullets: `async_calls` → `try_catch` → `decorators` → `jsdoc_tags`                                                               |
| **6** | `re_export_chains`, `module_cycles`                                                                                   | `dynamic_imports`; `files.is_barrel`; `files.has_side_effects` (heuristic — no Tier 8 `package.json` yet). **Not** `files.is_entry`.    |

## Pre-locked decisions (inherited)

- [R.16](./substrate-extraction.md#pre-locked-decisions): rebuild-forcing DDL → bump `SCHEMA_VERSION`; no in-place migrations.
- [R.18](./substrate-extraction.md#pre-locked-decisions): each slice ships ≥1 recipe + golden fixture update.
- [Tracer bullets](../../.agents/rules/tracer-bullets.md): vertical slice per commit; verify before next slice.

## Execution order

Priority = dependency order + reviewability. Each row is one commit (or commit pair: schema + tests).

### Phase A — Low-risk column extensions (Tier 1 + 4)

| Slice                | Work                                                                                                                                                                                                                                                 | SCHEMA    | Flagship recipe / golden                                                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.1**              | `calls` metadata in [`calls.ts`](../../src/extractors/calls.ts): `args_count` (NULL if spread), `is_method_call`, `is_constructor_call` (`NewExpression`), `is_optional_chain` (`node.optional` / callee.optional); dedup key includes call vs `new` | 27→**28** | Extend [`find-call-sites`](../../templates/recipes/find-call-sites.sql) SELECT; update [`fixtures/golden/minimal/find-call-sites.json`](../../fixtures/golden/minimal/find-call-sites.json) |
| **A.2**              | `symbols.{return_type,is_async,is_generator}` in [`symbols.ts`](../../src/extractors/symbols.ts) + [`type-stringify.ts`](../../src/extractors/type-stringify.ts); function-shaped kinds only                                                         | **29**    | New recipe `find-async-functions` + golden                                                                                                                                                  |
| **A.3** _(optional)_ | Side-effect import specifier row (`kind='side-effect'`) + `import_specifiers.import_id` FK                                                                                                                                                           | **30**    | Extend `find-import-sites` or new `find-side-effect-imports`                                                                                                                                |

**A.1 validation queries (post-index):**

```sql
SELECT callee_name, args_count, is_method_call, is_constructor_call, is_optional_chain
FROM calls WHERE file_path = 'src/extractors/calls.ts' LIMIT 5;

SELECT COUNT(*) FROM calls WHERE is_method_call = 1;
SELECT COUNT(*) FROM calls WHERE is_constructor_call = 1;
```

### Phase B — Module graph remainder (Tier 6, no C.9)

| Slice   | Work                                                                                                                                          | SCHEMA                       | Flagship                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| **B.1** | `dynamic_imports` table + visitor on `ImportExpression` in new [`src/extractors/dynamic-imports.ts`](../../src/extractors/dynamic-imports.ts) | **31**                       | `find-dynamic-imports` + golden                                                             |
| **B.2** | Post-pass `files.is_barrel` (100% re-exports, no value defs) in [`index-engine.ts`](../../src/application/index-engine.ts)                    | **32**                       | Extend [`barrel-files`](../../fixtures/golden/minimal/barrel-files.json) scenario or recipe |
| **B.3** | `files.has_side_effects` — top-level call/assign heuristic (Tier 8 `package.json` deferred)                                                   | **32** or same commit as B.2 | `find-side-effect-files`                                                                    |

### Phase C — Bindings polish (Tier 2)

| Slice   | Work                                                                                                                               | SCHEMA | Flagship                                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------- |
| **C.1** | Add `'re-exported'` to `bindings.resolution_kind` CHECK + walk in [`bindings-engine.ts`](../../src/application/bindings-engine.ts) | **33** | Extend rename-preview / find-references binding filter in golden |

### Phase D — JSX substrate (Tier 3)

| Slice   | Work                                                                                                                                      | SCHEMA | Flagship                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------- |
| **D.1** | `jsx_elements` table + tracer: self-closing + simple opening tags; `parent_element_id` post-link pass per [Q4](./substrate-extraction.md) | **34** | `find-jsx-usages` + golden on `fixtures/minimal` TSX |
| **D.2** | `jsx_attributes` + fragment rows (`is_fragment=1`)                                                                                        | **35** | Extend recipe with attribute JOIN                    |

New extractor registers after `referencesExtractor` (needs scope + refs). Does not replace [`componentsExtractor`](../../src/extractors/components.ts) heuristic.

### Phase E — Behavioral (Tier 5)

| Slice   | Work                                                              | SCHEMA | Flagship                                                       |
| ------- | ----------------------------------------------------------------- | ------ | -------------------------------------------------------------- |
| **E.1** | `async_calls` + context stack (`in_loop`, `in_try`)               | **36** | `find-unawaited-async-calls` (stretch) or `find-await-in-loop` |
| **E.2** | `try_catch`                                                       | **37** | `find-swallowed-errors`                                        |
| **E.3** | `decorators`                                                      | **38** | `find-decorator-usage`                                         |
| **E.4** | `jsdoc_tags` — extend [`jsdoc.ts`](../../src/extractors/jsdoc.ts) | **39** | `find-throws-jsdoc` / param tag queries                        |

Tier 5 slices depend on Tier 2 scopes (already shipped). `jsdoc_tags` can reuse existing `@deprecated` / visibility parsing.

## Per-slice Definition of Done

1. DDL + row types + `insert*` in [`src/db.ts`](../../src/db.ts).
2. Extractor or post-pass wired through [`parser.ts`](../../src/parser.ts) / [`index-engine.ts`](../../src/application/index-engine.ts).
3. Unit tests in [`src/parser.test.ts`](../../src/parser.test.ts) or dedicated `*.test.ts`.
4. Recipe + golden update when user-visible query shape changes.
5. [`docs/architecture.md`](../architecture.md) schema table row(s) for new columns/tables.
6. Checks: `bun run format:check`, `lint`, `typecheck`, affected `bun test`, `bun run test:golden` when golden touched.
7. Re-index before codemap validation queries.

## Draft PR (push when ready)

```markdown
## Summary

- Rollout plan for substrate tiers 1–6 remainder (excludes C.9 / `files.is_entry`).
- Tracer-bullet implementation: call-shape metadata on `calls`, then symbol async/return-type columns, module-graph enrichment, JSX, behavioral tables.

## Test plan

- [ ] `bun run check`
- [ ] `bun run test:golden`
- [ ] `bun src/index.ts --full` on self + `validate --json`
- [ ] Spot-check flagship recipes per shipped slice

## Out of scope

- C.9 plugin layer / `files.is_entry` / reachability pruning
- Tiers 7–13 (CSS rich, project meta, ORM, …)
```

Push: `git push -u origin feat/substrate-tiers-1-6 && gh pr create --draft --title "feat: substrate tiers 1–6 (no C.9)" --body-file …`

## Risk notes

- **Dedup semantics:** `calls` dedupes per `(caller_scope, callee)` today; constructor vs call with same name needs distinct dedup keys (A.1).
- **Spread args:** `args_count = NULL` when any argument is `SpreadElement` (substrate Tier 1 open question — bias adopted).
- **Barrel detection:** must not flag files with mixed re-exports and local value symbols.
- **JSX scope:** largest slice; keep D.1 minimal (no attribute values, no conditional render analysis).

## Closing

When all scoped slices ship: update [`substrate-extraction.md`](./substrate-extraction.md) per-tier ship status; lift completed items from [`roadmap.md`](../roadmap.md); close this plan (delete + lift per docs-governance).
