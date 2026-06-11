---
"@stainless-code/codemap": patch
---

`show` and `snippet` now use fast equality lookup for exact `name` and lone `name:Token` queries (no wildcards); substring, multi-field, and FTS paths stay on the broader slow tier. CLI and MCP tool descriptions document the two tiers.
