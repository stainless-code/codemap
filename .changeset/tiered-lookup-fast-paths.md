---
"@stainless-code/codemap": patch
---

Route lone `name:Token` show/snippet queries to equality index (`name = ?`) instead of substring LIKE. Add `idx_symbols_name_covering` for full `findSymbolsByName` SELECT. CLI and MCP tool descriptions document fast vs slow lookup tiers.
