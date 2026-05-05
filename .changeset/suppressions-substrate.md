---
"@stainless-code/codemap": minor
---

`suppressions` substrate — opt-in recipe-suppression markers parsed from source comments. The markers parser now recognises `// codemap-ignore-next-line <recipe-id>` and `// codemap-ignore-file <recipe-id>` (also `#`, `--`, `<!--`, `/*` leaders for non-JS files) and writes them to a new `suppressions(file_path, line_number, recipe_id)` table. Two scopes encoded by `line_number`: positive = next-line (the directive sits one line above; `line_number` points at the suppressed line), `0` = file scope.

Recipe authors opt in via `LEFT JOIN suppressions s ON s.file_path = … AND s.recipe_id = '<id>' AND (s.line_number = 0 OR s.line_number = <row's line>) WHERE s.id IS NULL`. Ad-hoc SQL is unaffected. Bundled recipes that opt in today: `untested-and-dead` (line + file) and `unimported-exports` (file only — `exports` has no `line_number` column, so per-line suppression isn't expressible there).

**Stays consistent with the "no opinionated rule engine" Floor** — no severity, no suppression-by-default, no universal-honor model. The suppression is consumer-chosen substrate: recipe authors choose whether to honor it; consumers can override per recipe by writing project-local SQL that ignores suppressions or filters differently. The leader regex requires the directive to start a line (modulo whitespace) so directives never match inside string literals — both this clone's tests and recipe `.md` examples use the directive text in prose without polluting the index.

Schema bumps to **10** — `--full` rebuild auto-runs on next index pass. `dropAll()` includes `suppressions` (index-data table, not user data). Surfaced in agent rules + skills + glossary + architecture schema docs per Rule 10.
