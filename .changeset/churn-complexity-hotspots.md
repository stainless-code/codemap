---
"@stainless-code/codemap": minor
---

Add churn × complexity hotspot ranking: `file_churn` refreshed on every index from git history, with `codemap ingest-churn`, MCP/HTTP `ingest_churn`, and config `churn.file` for non-git repos. Schema version 40 — existing indexes rebuild on next `codemap` run. New `churn-complexity-hotspots` recipe ranks files or symbols (`by_symbol`) by change frequency × complexity with normalized 0–100 scores and `churn_trend`. Outcome alias `hotspots` still maps to fan-in.
