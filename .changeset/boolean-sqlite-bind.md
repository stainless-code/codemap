---
"@stainless-code/codemap": patch
---

Fix recipes with `boolean` params failing on Node when run with defaults. Boolean params now bind as `0` / `1`, so recipes like `churn-complexity-hotspots` and `stale-imports` work again.
