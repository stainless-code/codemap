---
actions:
  - type: review-for-deletion
    auto_fixable: false
    description: "Exported function with zero callers AND zero test coverage — strong dead-code candidate. Verify against framework convention exports (Next.js page.tsx default exports, Storybook stories, vite.config.ts) before deleting; codemap doesn't model framework entry-points yet."
---

Exported functions that look structurally dead AND aren't covered by tests — the high-confidence "dead code" predicate.

Combines two evidence axes:

1. **Structural**: `is_exported = 1` AND no row in `calls` with `callee_name = s.name`.
2. **Runtime**: no `coverage` row OR `coverage_pct = 0` (treats both as "untested" via `COALESCE(c.coverage_pct, 0) = 0`).

Returns nothing useful until you've run `codemap ingest-coverage <coverage-final.json|lcov.info>` (Istanbul or LCOV from any test runner). Without coverage data, every uncalled exported function appears — coverage is what makes the predicate precise.

**Known v1 limitation (D11 of `docs/plans/coverage-ingestion.md`):** the `callee_name = s.name` predicate is name-only / lossy across cross-file collisions — two functions named `init` in different files will satisfy "no callers" together as long as neither is called _anywhere_. Three concrete narrowing patterns to apply on top of this recipe when the noise is high:

1. **Scope by directory**: `AND s.file_path LIKE 'src/api/%'` — restricts the predicate to a single owner / package.
2. **Exclude framework entry-point exports**: `AND s.is_default_export = 0` — Next.js page / layout / route handler default exports show up as "no callers" but are live entry points.
3. **Restrict to a kind / visibility**: already filters `kind = 'function'`; add `AND (s.visibility IS NULL OR s.visibility = 'public')` to skip `@internal` / `@beta` symbols whose lifecycle you don't yet own. The parentheses are load-bearing — without them SQL precedence (`AND` binds tighter than `OR`) would let every `visibility = 'public'` row bypass the `WHERE` clause entirely and balloon the result set.
