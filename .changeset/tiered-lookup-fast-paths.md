---
"@stainless-code/codemap": patch
---

`show` and `snippet` now use fast equality lookup for exact `name` and lone `name:Token` queries (no wildcards); substring, multi-field, and FTS paths stay on the broader slow tier. CLI help, MCP tool descriptions, and bundled agent guidance document the two tiers.
