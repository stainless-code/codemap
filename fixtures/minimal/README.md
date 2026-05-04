# Minimal codemap fixture

Stable tree exercising every codemap surface — used by `src/benchmark.ts`, golden tests, and CI.

## What's exercised

| Codemap surface                                                 | Fixture coverage                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `symbols` (function / const / interface / class)                | `usePermissions`, `createClient`, `setupTransport`, `openSocket`, `handshake`, `legacyClient`, `now`, `nanoseconds`, `_epochSeconds`, `_hiResEpoch`, `epochMs`, `nowIso`, `FormatPrice`, `ShopButton`, `ProductCard`, `get`, `invalidate`, `read`, `write`, `run` |
| `imports` / `exports` (named + default + re-export)             | `consumer.ts` named imports; `components/shop/index.ts` barrel re-exports; `ShopButton.default.ts` default export                                                                                                                                                 |
| `dependencies` (resolved file→file edges)                       | TS imports across `api/`, `lib/`, `components/shop/`, `utils/`, `usePermissions`                                                                                                                                                                                  |
| `components` (React)                                            | `ShopButton`, `ProductCard` (both call `usePermissions` — fan-in)                                                                                                                                                                                                 |
| `calls` (caller→callee, depth >1, with cycle)                   | `run → createClient → setupTransport → openSocket → handshake`; non-cyclic `cache.get → store.read`; 2-node cycle `cache.invalidate ↔ store.write`                                                                                                                |
| `markers` (TODO / FIXME / HACK / NOTE)                          | `notes.md` + `consumer.ts` (`XXX` is not yet a recognised kind)                                                                                                                                                                                                   |
| `type_members`                                                  | `ClientConfig`, `Transport`, `ProductCardProps`                                                                                                                                                                                                                   |
| Visibility tags (`@internal` / `@beta` / `@alpha` / `@private`) | `_epochSeconds`, `nowIso`, `nanoseconds`, `_hiResEpoch`                                                                                                                                                                                                           |
| `@deprecated`                                                   | `now`, `legacyClient`, `epochMs` (3 rows for SARIF / GH-annotations)                                                                                                                                                                                              |
| `css_variables`                                                 | `theme.css` (`--color-brand`, `--spacing-md`)                                                                                                                                                                                                                     |
| `css_classes`                                                   | `theme.css` (`.container`), `button.module.css` (`.primary`)                                                                                                                                                                                                      |
| `css_keyframes`                                                 | `button.module.css` (`fadeIn`)                                                                                                                                                                                                                                    |
| `--group-by owner`                                              | `CODEOWNERS` (4 owners)                                                                                                                                                                                                                                           |
| Project-local recipes                                           | `.codemap/recipes/shop-symbols.{sql,md}` (with frontmatter actions) — file shape valid; loader currently runs at parse time before bootstrap, so `--recipe shop-symbols` is rejected as "unknown" until that's deferred to the runner (known limitation)          |
| Self-managed `.gitignore`                                       | `.codemap/.gitignore` (codemap-managed)                                                                                                                                                                                                                           |
| `coverage` (Istanbul + LCOV ingest)                             | `coverage/coverage-final.json` (Istanbul) + `coverage/lcov.info` (LCOV) — equivalent partial coverage shape; bundled recipes `untested-and-dead`, `files-by-coverage`, `worst-covered-exports` exercise the join axis against `@deprecated` symbols               |

## Use

```bash
# Index the fixture from the codemap repo
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun run dev --full

# Benchmark
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun run benchmark

# Project-local recipe (known limitation: currently rejected as "unknown" — see
# the "Project-local recipes" row above; will work once recipe loading is
# deferred past bootstrap)
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun src/index.ts query --recipe shop-symbols --json

# Static coverage ingest — Istanbul (every modern JS test runner that emits
# coverage-final.json) or LCOV (e.g. `bun test --coverage`). Format auto-detected.
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun src/index.ts ingest-coverage coverage/coverage-final.json
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun src/index.ts ingest-coverage coverage/lcov.info

# After ingest — the killer recipe (exported + no callers + zero coverage)
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun src/index.ts query --recipe untested-and-dead --json
```

**Editor / `tsc`:** run `bun install` here so `react` + `@types/react` resolve `react/jsx-runtime` for `.tsx` (`jsx: "react-jsx"` in `tsconfig.json`).
