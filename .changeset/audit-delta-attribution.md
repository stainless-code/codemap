---
"@stainless-code/codemap": patch
---

On `audit --base <ref>` (CLI / MCP / HTTP), each `added` row carries `attribution: introduced | inherited` via stable finding keys against the merge-base audit cache. `--summary` adds `added_introduced` / `added_inherited` per delta.
