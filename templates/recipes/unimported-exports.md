---
actions:
  - type: review-for-deletion
    auto_fixable: false
    description: "Export with no detectable import — candidate for deletion. VERIFY against the v1 caveats below before deleting; codemap's import-resolution doesn't follow re-export chains or `tsconfig.json` path aliases that the resolver can't resolve."
---

Exports that have no row in `imports` referencing their file AND name. Surfaces the **direct-use-only** subset of "unused exports" — useful as a starting candidate list, but **NEVER as a "safe to delete" list** without manual verification.

## V1 limitations (false-positive classes)

The recipe ships intentionally simple. Three known classes of false positive:

1. **Re-export chains** — codemap's `exports.re_export_source` column tracks barrel-style `export { foo } from './foo'` re-exports, but this v1 recipe **does not follow the chain**. If `src/index.ts` re-exports `bar` from `src/bar.ts`, and consumers `import { bar } from '~/'` (hitting `src/index.ts`), this recipe falsely flags `bar` in `src/bar.ts` as unimported. Workaround: filter out rows with `re_export_source IS NOT NULL` in a project-local override, OR cross-check against `barrel-files` recipe output.
2. **Unresolved imports** — when `imports.resolved_path IS NULL` (e.g. `tsconfig.json` path aliases codemap's resolver can't resolve, or external-package imports), those rows are ignored. If the unresolved import actually targets the export, it's a false positive. Codemap's resolver covers most TS / JS shapes; this is a corner case for unusual config.
3. **Default exports skipped** — `is_default = 0` filter. Default exports are commonly framework entry points (Next.js `page.tsx`, Storybook stories, `vite.config.ts`) that codemap doesn't model; flagging them produces high false-positive noise. To include them, drop the `AND e.is_default = 0` clause in a project-local override.

## What's NOT covered (orthogonal recipes)

- **Re-export chain handling** — wait for a future recipe with recursive CTE walking `re_export_source`. Tracked under research note § 1.2 ("re-export chains need a JOIN through `re_export_source` to avoid false positives").
- **Component-touching-deprecated** style cross-checks — not applicable here; this recipe is about EXPORTS, not symbol references inside files.

## Tuning axes for project-local overrides

- **Strip framework entry-point patterns** — add `AND e.file_path NOT LIKE '%/page.tsx' AND e.file_path NOT LIKE '%/layout.tsx' AND e.file_path NOT LIKE '%.stories.tsx'` to exclude common Next.js / Storybook conventions.
- **Filter to a directory** — add `AND e.file_path LIKE 'src/lib/%'` to scope the audit to a single owner / package.
- **Include re-exports** — drop `AND e.kind != 're-export'` if you want to flag stale re-exports too (e.g. a barrel that re-exports a symbol nobody imports anymore).
