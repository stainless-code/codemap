---
"@stainless-code/codemap": patch
---

`createCodemap()` and the CLI now reject invalid project config at load time. A second `createCodemap()` with a different project root in the same process throws (audit `--base` worktree reindex is exempt).
