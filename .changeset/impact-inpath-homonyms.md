---
"@stainless-code/codemap": patch
---

Scope `codemap impact` and MCP/HTTP `impact` homonym symbols: `--in` / `in` disambiguates by defining file (show-engine prefix/exact rules); unscoped homonyms union per-defining-file call graphs instead of merging by name only. Mismatched scope returns empty `matches` with `skipped_scope`.
