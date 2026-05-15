---
"@stainless-code/codemap": patch
---

**`codemap audit --base <ref>` now materialises the sha-keyed cache via `git archive | tar -x` instead of `git worktree add`.** The cache entry at `.codemap/audit-cache/<sha>/` is a plain extracted tree with no `.git` pointer file and no registered git worktree, so:

- `git clean -xdf` sweeps it without needing `-ff` (which used to also nuke unrelated nested repos).
- Plain `rm -rf` works — no more dangling registrations under `<repo>/.git/worktrees/` that needed `git worktree prune`.

All other invariants preserved: cache path layout, hit detection (`<sha>/.codemap/index.db` exists), atomic populate (per-pid temp + POSIX `rename`), LRU eviction (5 entries / 500 MiB), error code names (`worktree-add-failed` etc. kept for API stability — external consumers discriminate on `code`, not the underlying primitive).

Also: the cache reindex now stamps `meta.last_indexed_commit` with the resolved sha directly instead of shelling out to `git rev-parse HEAD` inside the cache dir — silences a `fatal: not a git repository` stderr line that older revisions leaked.

**Migration** — existing consumers with `.codemap/audit-cache/<sha>/` worktrees from earlier versions can run `git worktree prune` once after upgrade to clear dangling registrations. The registrations are inert when the path is gone, so skipping the prune is harmless.
