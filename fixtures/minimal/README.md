# Minimal benchmark fixture

Stable tree for **repeatable** `src/benchmark.ts` runs and CI.

- **Index from the codemap repo:** `CODEMAP_ROOT="$(pwd)/fixtures/minimal" bun run dev --full`
- **Benchmark:** same `CODEMAP_ROOT`, then `bun run benchmark`

Includes intentional symbols (`usePermissions`), a `~/api/client` import, `components/shop/*`, `utils/date`, CSS variables, and a TODO marker.
