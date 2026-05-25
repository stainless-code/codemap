# Index lock and error log — plan

> **Status:** open · **Priority:** P1 · **Effort:** M (~1 week)
>
> **Motivator:** MCP server, file watcher, git hooks, and CLI can index concurrently. SQLite `busy_timeout` alone causes opaque hangs. Per-file parse failures are easy to miss without a persistent log.
>
> **Roadmap:** [§ Backlog — Agent surface & ops](./agent-surface-and-ops.md#p1)

---

## Pre-locked decisions

| #   | Decision                                                                                                          | Source              |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------- |
| L.1 | Lock file at **`<state-dir>/index.lock`** — JSON `{ pid, started_at }`.                                           | Cross-process guard |
| L.2 | **Stale lock detection** — if PID dead or lock older than threshold, `codemap unlock` or auto-steal with warning. | Recovery path       |
| L.3 | **In-process mutex** still required for same-process MCP + watcher races.                                         | Layer both          |
| L.4 | **`errors.log`** append-only in state dir; one line per failed file with path + reason.                           | Ops visibility      |
| L.5 | Fail-fast on lock acquire — return actionable message, not spin.                                                  | UX                  |

---

## Implementation steps

1. **`src/application/index-lock.ts`**
   - `acquireLock(stateDir)`, `releaseLock()`, `isStale(lockPath)`
2. **Integrate in `run-index.ts` / `index-engine.ts`** — try/finally release
3. **CLI `codemap unlock`** — remove stale lock (`src/cli/cmd-unlock.ts` or subcommand)
4. **`src/application/error-log.ts`** — append on parse/resolver failures
5. **Ensure `.codemap/.gitignore`** includes `errors.log` optional (or keep for local debug — decide: gitignore `errors.log`)
6. **Tests** — concurrent process simulation; stale PID; unlock CLI
7. **Docs** — troubleshooting in README; link from [git-hook-auto-sync](./git-hook-auto-sync.md)

---

## Acceptance

- [ ] Second concurrent index fails fast with "run codemap unlock"
- [ ] Stale lock recoverable
- [ ] Parse errors visible in `errors.log` after index with bad fixture

---

## Dependencies

- Coordinate with [git-hook-auto-sync](./git-hook-auto-sync.md) and [parse-worker-hardening](./parse-worker-hardening.md) for logged timeout failures
