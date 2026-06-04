# Codemap in-repo test bench (corpus)

Stable tree exercising every codemap surface — used by `test:golden`, `test:agent-eval`, `src/benchmark.ts`, and CI. Hub: [fixtures/README.md](../README.md). Capability map: [CAPABILITIES.json](../CAPABILITIES.json).

## What's exercised

| Codemap surface                         | Fixture coverage                                                                                                                                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tier 1 — position + calls + imports** | Column-precise `symbols` / `imports` / `markers`; `calls.{args_count,is_method_call,is_constructor_call,is_optional_chain}` (`consumer.ts` spread + `new ApiCache()` + optional chain); side-effect `import_specifiers` (`polyfill.ts`); `import_id` FK |
| **Tier 2 — references / bindings**      | `find-references`, `find-write-sites`, `find-symbol-references`, `find-re-exported-bindings` via shop barrel + `consumer.ts`                                                                                                                            |
| **Tier 3 — JSX**                        | `ProductCard.tsx` — fragments, nested elements, spread/boolean/expression attrs, self-closing `<img />`, lowercase tags                                                                                                                                 |
| **Tier 4 — types on symbols**           | `return_type` / `is_async` on `prefetch`; `@param` / `@returns` / `@throws` → `jsdoc_tags` on `createClient`; **`type_heritage`** + **`type-ancestors` / `type-descendants`** on `src/types/hierarchy.ts` and `heritage-qualified.ts`                   |
| **Tier 5 — behavioral**                 | `await` in loop (`prefetch`); swallowed catch (`cache.ts`); `catch_rethrows` heuristics (`complexity-fixture.ts`); `@sealed` decorator (`decorated.ts`); `@throws` jsdoc                                                                                |
| **Tier 6 — module graph**               | `files.is_barrel` (`components/shop/index.ts`); `has_side_effects` (`polyfill.ts`); `dynamic_imports` (`prefetch`)                                                                                                                                      |
| **`symbols`**                           | function / const / interface / class / enum / method; visibility + `@deprecated` tags                                                                                                                                                                   |
| **`imports` / `exports`**               | Named, default, namespace (`date` util), re-exports, side-effect import                                                                                                                                                                                 |
| **`dependencies`**                      | Resolved edges + 2-node cycle (`cache ↔ store`) + boundary violation (`ApiBridge → api`)                                                                                                                                                                |
| **`components`**                        | `ShopButton`, `ProductCard` — `usePermissions` fan-in; `components-touching-deprecated` via `now()`                                                                                                                                                     |
| **`calls`**                             | Depth >1 chain (`createClient → … → handshake`); cycle edges; optional chain; constructor; spread args                                                                                                                                                  |
| **`markers`**                           | `notes.md` + inline `FIXME`/`HACK` in `consumer.ts` / `format.ts`                                                                                                                                                                                       |
| **`type_members`**                      | `ClientConfig`, `Transport`, `ProductCardProps`; homonym guard via `src/types/homonym-mammal.ts` (`Mammal` name collision)                                                                                                                              |
| **`css_*`**                             | Variables, classes, keyframes, `@import`                                                                                                                                                                                                                |
| **`test_suites`**                       | `src/__tests__/smoke.test.ts` — skip / only / todo / nested describe (vitest)                                                                                                                                                                           |
| **`file_metrics` / complexity**         | `lib/complexity-fixture.ts` — `large-functions`, `deeply-nested-functions`, `high-complexity-untested`, `catch_rethrows` heuristics                                                                                                                     |
| **`runtime_markers`**                   | `console.*`, `process.env` (`env.ts`), `throw` path in cache                                                                                                                                                                                            |
| **`suppressions`**                      | `codemap-ignore-next-line` in `orphan.ts`                                                                                                                                                                                                               |
| **`boundaries`**                        | `.codemap/config.json` — `ui-no-api` deny rule → `boundary-violations` recipe                                                                                                                                                                           |
| **`fts5`**                              | `fts5: true` in config — powers `text-in-deprecated-functions`                                                                                                                                                                                          |
| **`coverage`**                          | Istanbul + LCOV under `coverage/` — killer recipes + refactor-risk                                                                                                                                                                                      |
| **`orphan` exports**                    | `orphan.ts` — `unimported-exports`                                                                                                                                                                                                                      |
| **Project-local recipes**               | `.codemap/recipes/shop-symbols.{sql,md}`                                                                                                                                                                                                                |
| **`CODEOWNERS`**                        | `--group-by owner`                                                                                                                                                                                                                                      |

## Golden scenarios

Tier A regression: `fixtures/golden/scenarios.json` → `fixtures/golden/minimal/<id>.json`. Coverage map: [docs/testing-coverage.md](../../docs/testing-coverage.md). Guard: `scripts/query-golden-coverage-matrix.test.mjs` (via `bun run test:scripts`).

Substrate pin-down scenarios added for tables not fully locked by recipes alone: `index-table-stats`, `meta-fts5-enabled`, `source-fts-row-count`, `file-metrics-complexity-fixture`, `scopes-product-card`, `references-product-card-perms`, `bindings-createClient`, `import-specifiers-consumer`, `async-calls-prefetch`, `decorators-sealed`, `dynamic-imports-prefetch`, `module-cycles-cache-store`, `re-export-chains-product-card`, `runtime-markers-env`, `function-params-createClient`, `boundary-rules-ui-no-api`, plus call-resolution (`call-resolution-stats`, `unresolved-call-sites`, `calls-createClient-resolved`).

## Use

```bash
# Index the fixture from the codemap repo
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun run dev --full

# Golden queries (updates goldens after fixture changes)
bun run test:golden -- --update

# Benchmark
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun run benchmark

# Coverage ingest + killer recipe
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun src/index.ts ingest-coverage coverage/coverage-final.json
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun src/index.ts query --recipe untested-and-dead --json
```

**Editor / `tsc`:** run `bun install` here so `react` + `@types/react` resolve `react/jsx-runtime` for `.tsx` (`jsx: "react-jsx"` in `tsconfig.json`).
