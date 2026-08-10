---
"@stainless-code/codemap": patch
---

Fix recipe `boolean` params failing at SQLite bind time on Node (`better-sqlite3`). Values now bind as `0` / `1`, so recipes like `churn-complexity-hotspots` and `stale-imports` run with defaults.
