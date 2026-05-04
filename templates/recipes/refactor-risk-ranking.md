---
actions:
  - type: review-refactor-impact
    auto_fixable: false
    description: "High refactor-risk file — many callers AND/OR low test coverage. Read all callers and add tests before changing any exported symbol's signature."
---

Files ranked by refactor-risk score `(fan_in + 1) × (100 - avg_coverage_pct)`.

Higher score = higher refactor risk. Output is **per-file** (one row per high-risk file) — symbols within a file inherit the file's structural risk.

**Why per-file (not per-symbol):** `dependencies` is tracked at the file level — every symbol in a popular file ties at the same score under per-symbol ranking, producing 30 noisy rows from one file. File-level aggregation gives 30 actionable rows ranking the riskiest files. Drill into a specific file's symbols via `query --recipe ad-hoc "SELECT name, kind, signature FROM symbols WHERE file_path = '<path>' AND is_exported = 1"`.

Three correctness fixes baked into the formula:

1. **Files with zero callers (`fan_in = 0`)** score on coverage alone via the `+1`. Untested zero-fan-in files = high risk for surprising remote callers we don't track (hidden imports, dynamic loads). Tested zero-fan-in files rank low — candidates for deletion review, not refactor.
2. **NULL `coverage_pct`** (no coverage measurement) treated as `0%` via `COALESCE(coverage_pct, 0)` per-row. Without this, `100 - NULL = NULL` would silently drop rows from `ORDER BY` — files without measured coverage would vanish from the ranking. Treat unmeasured as untested = high risk.
3. **Files with no exports excluded** (`WHERE exported_count > 0`) — they have no public-API surface to refactor externally; the recipe is about cross-file refactor cost.

The output columns `exported_count`, `fan_in`, `avg_coverage_pct`, `measured_symbols`, `risk_score` give agents enough context to triage without re-running queries: count of exports + how many files import this one + average coverage of measured symbols + how many symbols had measurements.

**v1 trade-off (linear-in-fan_in, accepted):** `fan_in = 100, avg_coverage = 99%` and `fan_in = 1, avg_coverage = 0%` both score `100` — equivalent by formula but obviously not equivalent in practice. v1 ships the simple formula; tune via project-local recipe override at `<projectRoot>/.codemap/recipes/refactor-risk-ranking.sql`.

Suggested tuning axes for project-local overrides:

- **Log-scale `fan_in`** for hub-heavy codebases — diminishing returns above ~20 callers: `LOG(fan_in + 1) * 30`.
- **Per-symbol fan_in via `calls`** if you'd rather rank symbols than files: replace the `fan_in_per_file` CTE with `SELECT callee_name, COUNT(DISTINCT caller_name || '|' || file_path) AS fan_in FROM calls GROUP BY callee_name`. Caveat: name-collision false positives across files.
- **Visibility weight** if `@public` / `@internal` / `@beta` JSDoc tags are used consistently: `+ CASE visibility WHEN 'public' THEN 20 WHEN 'beta' THEN 10 ELSE 0 END`.
- **LOC weight** scale by file `line_count` (already on the `files` table).

**Divergence from research note (`docs/research/non-goals-reassessment-2026-05.md` § 1.4):** the research note specified per-symbol ranking. Empirical test against codemap's own index showed per-symbol output was 30 rows from `src/db.ts` all tied at the same score (file-level fan_in inherited). v1 ships file-level aggregation as the more useful default; per-symbol via `calls` is one of the documented tuning axes above.
