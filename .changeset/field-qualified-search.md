---
"@stainless-code/codemap": patch
---

Add field-qualified symbol discovery on `codemap show --query` and MCP/HTTP `show` / `snippet` via a `query` argument (`kind:`, `name:`, `path:`, `in:` + optional free text). Includes parameterized SQL engine, optional FTS join, `--print-sql` Moat-A transparency, and `{matches, disambiguation?, warning?}` envelope parity across CLI, MCP, and HTTP.
