---
"@stainless-code/codemap": minor
---

Add churn × complexity hotspot ranking: `file_churn` from git on every index (incremental scoped refresh, idle HEAD cache), `codemap ingest-churn` + `churn.file` for non-git, bundled `churn-complexity-hotspots` recipe with file/symbol grain (`by_symbol`), raw + 0–100 normalized scores, and `churn_trend`. Outcome alias `hotspots` still maps to fan-in.
