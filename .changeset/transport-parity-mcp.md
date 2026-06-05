---
"@stainless-code/codemap": patch
---

Add MCP/HTTP transport parity for coverage ingest and query baselines: new `ingest_coverage` tool (CLI twin `codemap ingest-coverage --json`) and optional `baseline` param on `query` / `query_recipe` (same diff envelope as `codemap query --baseline`). Tool count 19 → 20.
