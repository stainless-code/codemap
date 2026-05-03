# Minimal codemap fixture

Stable tree exercising every codemap surface — used by `src/benchmark.ts`, golden tests, and CI.

## What's exercised

| Codemap surface                                                 | Fixture coverage                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `symbols` (function / const / interface / class)                | `usePermissions`, `createClient`, `setupTransport`, `openSocket`, `handshake`, `legacyClient`, `now`, `nanoseconds`, `_epochSeconds`, `_hiResEpoch`, `epochMs`, `nowIso`, `FormatPrice`, `ShopButton`, `ProductCard`, `get`, `invalidate`, `read`, `write`, `run` |
| `imports` / `exports` (named + default + re-export)             | `consumer.ts` named imports; `components/shop/index.ts` barrel re-exports; `ShopButton.default.ts` default export                                                                                                                                                 |
| `dependencies` (resolved file→file edges)                       | TS imports across `api/`, `lib/`, `components/shop/`, `utils/`, `usePermissions`                                                                                                                                                                                  |
| `components` (React)                                            | `ShopButton`, `ProductCard` (both call `usePermissions` — fan-in)                                                                                                                                                                                                 |
| `calls` (caller→callee, depth >1, with cycle)                   | `run → createClient → setupTransport → openSocket → handshake`; cycle `cache.get → store.read → cache.invalidate → store.write → cache.get`                                                                                                                       |
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

## Use

```bash
# Index the fixture from the codemap repo
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun run dev --full

# Benchmark
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun run benchmark

# Project-local recipe
CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun src/index.ts query --recipe shop-symbols --json
```

**Editor / `tsc`:** run `bun install` here so `react` + `@types/react` resolve `react/jsx-runtime` for `.tsx` (`jsx: "react-jsx"` in `tsconfig.json`).
