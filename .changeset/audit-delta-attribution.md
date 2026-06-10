---
"@stainless-code/codemap": patch
---

On `audit --base <ref>` (CLI / MCP / HTTP), each `added` row carries `attribution: introduced | inherited` (branch-new vs pre-existing at merge base). `--summary` adds `added_introduced` / `added_inherited` per delta.
