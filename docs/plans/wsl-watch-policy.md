# WSL watch policy — plan

> **Status:** open · **Priority:** P0 · **Effort:** S (~3 days)
>
> **Motivator:** Recursive file watchers on WSL2 Windows mounts (`/mnt/c/...`) are unreliable and slow. Codemap starts chokidar unconditionally on `mcp` / `serve` / `watch`, which can hang or miss events on those paths.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p0)

---

## Pre-locked decisions

| #   | Decision                                                                                                    | Source                   |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| L.1 | **Single module** `watchDisabledReason(root)` shared by watcher, MCP boot, and `agents init` diagnostics.   | DRY; one source of truth |
| L.2 | Env precedence: `CODEMAP_NO_WATCH=1` → off; `CODEMAP_FORCE_WATCH=1` → on; WSL `/mnt/*` → off unless forced. | Explicit override wins   |
| L.3 | When disabled, **stderr explains why** and points to [git-hook-auto-sync](./git-hook-auto-sync.md).         | Layered freshness stack  |

---

## Implementation steps

1. **Add `src/application/watch-policy.ts`**
   - `detectWsl()` — read `/proc/version` or `WSL_DISTRO_NAME`
   - `isWindowsDriveMount(root)` — path starts with `/mnt/` + single letter
   - `watchDisabledReason(root, env?)` → `string | null`
2. **Integrate in `src/application/watcher.ts` and `cmd-mcp.ts` / `cmd-serve.ts`**
   - Skip watcher start when reason non-null; log reason once
3. **Tests** — unit tests with injected probe (no real WSL required)
4. **Docs** — [architecture.md](../architecture.md) freshness section; env vars in README

---

## Acceptance

- [ ] Project on `/mnt/c/...` under WSL2 skips watcher by default with actionable message
- [ ] `CODEMAP_FORCE_WATCH=1` overrides detection
- [ ] Existing `CODEMAP_WATCH=0` behavior unchanged

---

## Dependencies

Pairs with [git-hook-auto-sync](./git-hook-auto-sync.md) as fallback.
