---
"@stainless-code/codemap": patch
---

Add hash-stable `map_id` and `codebase_map` routing hints to `context` responses (CLI, MCP, HTTP). MCP initialize instructions now include `map_id` and top hub paths. Opt out with `--no-codebase-map` or `include_codebase_map: false`; omitted when `compact`.
