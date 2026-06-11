---
"@stainless-code/codemap": minor
---

`createCodemap()` now fails fast when switching to a different project root in the same process (audit `--base` worktree reindex is exempt), and invalid config files throw at load time instead of on first use.
