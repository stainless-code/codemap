---
"@stainless-code/codemap": patch
---

feat(recipes): ship two new bundled recipes from research note § 1

- **`components-touching-deprecated`** (research note § 1.1) — UNION of two paths surfacing components that touch `@deprecated` symbols: hook path (`components.hooks_used` JSON overlap) + call path (`calls.caller_name = component`, `callee_name` is `@deprecated`). Hook-only variants ship false negatives — recipe spells out the explicit UNION. Action template `review-deprecation-impact`.
- **`refactor-risk-ranking`** (research note § 1.4) — per-file ranking by `(fan_in + 1) × (100 - avg_coverage_pct)`. Three correctness fixes vs the naïve formula: orphans (`fan_in = 0`) score on coverage alone via `+1`; NULL `coverage_pct` treated as 0% via `COALESCE` (otherwise the row drops from `ORDER BY`); files with no exports excluded (no public-API surface to refactor externally). Output is per-file (not per-symbol) — empirical test showed per-symbol ranking ties on file-level fan_in. Per-symbol via `calls` is a documented tuning axis for project-local override. Action template `review-refactor-impact`.

Both recipes use only existing substrate (`components`, `calls`, `symbols`, `dependencies`, `coverage`, `files`) — no schema bump. Bundled recipe content follows the existing recipe-as-content registry pattern (PR #37); project-local overrides live at `<projectRoot>/.codemap/recipes/<id>.{sql,md}`.

Agent rule + skill lockstep updated per `docs/README.md` Rule 10 — both `templates/agents/` (ships to npm via `codemap agents init`) and `.agents/` (this clone's mirror) gain trigger-pattern entries, quick-reference rows, and recipe-id list updates.
