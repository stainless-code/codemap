---
"@stainless-code/codemap": patch
---

feat(recipes): ship `unimported-exports` recipe (research note § 1.2)

Surfaces exports that have no detectable import. Useful as a starting candidate list for "what's unused?" — explicitly **NOT** a "safe to delete" list.

V1 limitations documented in the recipe `.md`:

1. **Re-export chains not followed** — false positives if A re-exports `bar` from B and consumers import `bar` from A. Tracked under research note § 1.2; future recipe with recursive CTE walking `re_export_source` will close the gap.
2. **Unresolved imports ignored** — when `imports.resolved_path IS NULL` (codemap's resolver couldn't resolve a `tsconfig.json` path alias or external package), those rows don't count toward "used" matching.
3. **Default exports skipped** — common framework entry points (Next.js `page.tsx`, Storybook stories, `vite.config.ts`) skipped to reduce noise. Override in project-local recipe if you want to include them.

Action template `review-for-deletion` (auto_fixable: false) — agents flag for manual verification before deletion.

Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` and `.agents/` codemap rule + skill gain trigger-pattern row, quick-reference row, and recipe-id list update.
