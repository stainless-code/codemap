---
"@stainless-code/codemap": minor
---

`codemap audit --base <ref>` — ad-hoc structural-drift audit against any git committish (`origin/main`, `HEAD~5`, `<sha>`, tag, …). Closes the highest-frequency post-watch agent loop: "what changed structurally between this branch and `origin/main`?". Replaces today's 3-step `--baseline` dance (switch branches, reindex, save baselines, switch back) with one verb.

**Three transports, one engine:**

- **CLI:** `codemap audit --base <ref> [--<delta>-baseline <name>] [--summary] [--json] [--no-index]`
- **MCP tool:** `audit` with new `base?: string` arg
- **HTTP:** `POST /tool/audit` (auto-wired via the existing dispatcher)

All three dispatch the same pure `runAuditFromRef` engine in `application/audit-engine.ts`.

**How it works:**

1. `git rev-parse --verify "<ref>^{commit}"` resolves `<ref>` to a sha (clean error on non-git or unresolvable ref).
2. Cache lookup at `<projectRoot>/.codemap/audit-cache/<sha>/.codemap.db`. Hit → sub-100ms; miss → continue.
3. **Atomic populate** — `git worktree add` to a per-pid temp dir + `runCodemapIndex({mode: "full"})` against the worktree's `.codemap.db` + POSIX `rename` claims the final `<sha>/` slot. Concurrent CI matrix runs against the same sha race-safely without lock files (loser's rename fails with EEXIST → falls through to cache hit).
4. Run each delta's canonical SQL on the cached DB vs the live DB; `diffRows` (existing helper) computes `{added, removed}`.
5. Compose `AuditEnvelope` with per-delta `base.source: "ref"` (new value) + `base.ref` (user-supplied string) + `base.sha` (resolved).

**Decisions worth knowing:**

- **`AuditBase` is now a discriminated union** — existing `{source: "baseline", name, sha, indexed_at}` rows untouched; new `{source: "ref", ref, sha, indexed_at}` arm. Consumers narrowing on `base.source` keep compiling.
- **Mutually exclusive with `--baseline <prefix>`.** Parser + handler both guard. Per-delta `--<key>-baseline` overrides compose orthogonally with both, so `--base origin/main --files-baseline pre-refactor-files` is valid (mixed sources).
- **Eviction:** hardcoded LRU 5 entries / 500 MiB; `git worktree remove --force` + `rm -rf` for each victim. Orphan `.tmp.*` dirs older than 10 min get swept on the next cycle. No config knobs in v1; defer to v1.x+ if real consumers ask.
- **Hard error on non-git projects.** No graceful fallback — there's no meaningful "ref" without git. The other audit modes (`--baseline`, `--<delta>-baseline`) still work without git.
- **Env hygiene.** All git spawns in `audit-worktree.ts` strip inherited `GIT_*` env vars so a containing git operation (e.g. running codemap from a husky hook) doesn't route worktree calls at the wrong index.

**Auto-`.gitignore`:** `codemap agents init` now adds `.codemap/audit-cache/` alongside `.codemap.*` so cached worktrees never get committed. `.codemap/recipes/` stays git-tracked.

Plan: PR #51 (merged). Implementation: PR #52.
