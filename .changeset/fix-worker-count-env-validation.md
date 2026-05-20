---
"codemap": patch
---

Reject malformed `CODEMAP_PARSE_WORKERS` values (e.g. `2abc`, `1.5`) instead of silently truncating with `parseInt`.
