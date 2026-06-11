---
"@stainless-code/codemap": minor
---

`createCodemap()` and `loadUserConfig()` now fail fast: switching to a different project root in the same process throws (audit `--base` worktree reindex is exempt), and invalid config files throw at load time instead of on first resolve.
