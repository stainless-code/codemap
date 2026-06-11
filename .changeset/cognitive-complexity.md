---
"@stainless-code/codemap": minor
---

Add SonarSource cognitive complexity on `symbols` (same function-shaped coverage as cyclomatic, including class methods). Schema version 38 — existing indexes rebuild on next `codemap` run. New recipe `high-cognitive-complexity`; `high-complexity-untested` rows include `cognitive_complexity`.
