# Git hook auto-sync — plan

> **Status:** open · **Priority:** P0 · **Effort:** S (~1 week)
>
> **Motivator:** When the file watcher is off (WSL mounts, CI, user preference), the index goes stale until manual `codemap`. Git hooks can run a background incremental index after commit/merge/checkout without blocking git.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p0) · complements [wsl-watch-policy](./wsl-watch-policy.md)

---

## Pre-locked decisions

| #   | Decision                                                                                                                        | Source                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| L.1 | **Opt-in only** — `codemap agents init --git-hooks`; never auto-modify `.git/hooks` without consent.                            | Safety                               |
| L.2 | Hook body runs `( codemap >/dev/null 2>&1 & )` — non-blocking background incremental index.                                     | Don't slow git                       |
| L.3 | **Marker-delimited blocks** in hook files for idempotent install/uninstall (`<!-- CODEMAP_START -->` … `<!-- CODEMAP_END -->`). | Same pattern as agents init sections |
| L.4 | Hooks: `post-commit`, `post-merge`, `post-checkout` (optional subset documented).                                               | Cover common freshness gaps          |

---

## Implementation steps

1. **Add `src/application/git-hooks.ts`**
   - `installGitHooks(root, hooks: ('post-commit' | ...)[])`
   - `uninstallGitHooks(root)`
   - `isCodemapHookInstalled(path)`
2. **CLI flag** — `codemap agents init --git-hooks` (+ offer in interactive flow when [watch-policy](./wsl-watch-policy.md) returns disabled)
3. **Uninstall path** — `agents init --force` does not remove hooks; document `codemap agents init --no-git-hooks` or separate uninstall
4. **Tests** — temp git repo; verify marker injection/removal; hook invokes codemap when binary on PATH
5. **Docs** — [agents.md](../agents.md), troubleshooting for hook + lock interaction ([index-lock-and-error-log](./index-lock-and-error-log.md))

---

## Acceptance

- [ ] Install adds non-blocking sync to selected hooks
- [ ] Re-run install is idempotent
- [ ] Uninstall removes only codemap-marked blocks
- [ ] Offered automatically when watcher disabled per watch-policy

---

## Dependencies

- Recommended after [wsl-watch-policy](./wsl-watch-policy.md)
- Coordinate with [index-lock-and-error-log](./index-lock-and-error-log.md) for concurrent hook + MCP writes
