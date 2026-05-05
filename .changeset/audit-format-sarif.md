---
"@stainless-code/codemap": minor
---

`codemap audit --format <text|json|sarif>` — emit a SARIF 2.1.0 doc directly from the audit envelope, no JSON→SARIF transform step needed. One rule per delta key (`codemap.audit.files-added`, `codemap.audit.dependencies-added`, `codemap.audit.deprecated-added`); one result per `added` row; severity = `warning` (audit deltas are more actionable than per-recipe `note`). Locations auto-detected via the same `file_path` / `path` / `to_path` / `from_path` priority list that `query --format sarif` uses; line ranges (`line_start` / `line_end`) populate the SARIF `region`. Pure output-formatter addition on top of the existing audit envelope; no schema impact.

`--json` stays as the shortcut for `--format json` (backward-compatible). `--json` + `--format <other>` rejected as a contradiction. `--summary` is a no-op with `--format sarif` (SARIF results are per-row, not counts) and surfaces a stderr warning.

`removed` rows are intentionally excluded from SARIF output — SARIF surfaces findings to act on, not cleanups. Location-only rows (e.g. files-added has only `path`) get a "new files: src/foo.ts" message instead of the generic "(no message)" fallback.

This is the first half of Slice 1 from the [GitHub Marketplace Action plan](../docs/plans/github-marketplace-action.md) — independently useful for any CI consumer running `codemap audit` who wants Code Scanning surface without a translation layer; required for the upcoming Marketplace Action's headline default command.
