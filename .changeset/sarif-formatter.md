---
"@stainless-code/codemap": minor
---

`codemap query --format <text|json|sarif|annotations>` — pipe any recipe row-set into GitHub Code Scanning (SARIF 2.1.0) or surface findings inline on PRs (GH Actions `::notice file=…,line=…::msg`). Pure output-formatter additions on top of the existing JSON pipeline; no schema impact.

Auto-detects file-path columns (`file_path` / `path` / `to_path` / `from_path` priority) and `line_start` (+ optional `line_end`) for SARIF region. Aggregate recipes without locations (`index-summary`, `markers-by-kind`) emit `results: []` + a stderr warning. Rule id is `codemap.<recipe-id>` for `--recipe`, `codemap.adhoc` for ad-hoc SQL. Default `result.level` is `"note"`; per-recipe overrides via `<id>.md` frontmatter (`sarifLevel`, `sarifMessage`, `sarifRuleId`) deferred to v1.x.

`--format` overrides `--json` when both passed; `--json` stays as the alias for `--format json`. Incompatible with `--summary` / `--group-by` / baseline (different output shapes — sarif/annotations only support flat row lists).

MCP `query` and `query_recipe` tools accept the same `format: "sarif" | "annotations"` argument; `query_batch` deferred to v1.x.
