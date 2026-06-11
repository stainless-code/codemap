# PR 3 — runtime guards & test isolation

> **Status:** open (in progress) · **PR:** 3 of 3 · **Effort:** S–M
>
> **Orchestrator:** [`security-hardening-orchestrator.md`](./security-hardening-orchestrator.md)
>
> **Motivator:** Codify one-root-per-process constraint; stop silent `initCodemap` root bleed in tests; fail-fast invalid config at load. Maintainer-heavy; small user-visible API change (`createCodemap` second root throws).

---

## Agent start here

**Blocked until PR 1 merges** (PR 2 optional beforehand).

### Key touchpoints

| File                                | What                                                |
| ----------------------------------- | --------------------------------------------------- |
| `src/runtime-swap.ts`               | Audit worktree root bracket (new)                   |
| `src/runtime.ts`                    | Throw on root switch                                |
| `src/resolver.ts`                   | Resolver reset / guard                              |
| `src/test-helpers/runtime-reset.ts` | `resetCodemapForTest`, `installCodemapTestTeardown` |
| `src/application/audit-engine.ts`   | `makeWorktreeReindex` bracket                       |
| `src/config.ts` / `state-config.ts` | `loadUserConfig` validation                         |
| `src/api.ts`                        | Doc: throws vs last-wins                            |

### Suites needing teardown rollout (grep `initCodemap`)

`churn-ingest.test.ts`, `context-engine.test.ts`, `trace-engine.test.ts`, `worker-pool.dist.test.ts`, `cmd-affected` tests, `recipe-recency.test.ts`, `benchmark-config.test.ts`, `agents-init.test.ts`, … — complete list in PR diff.

---

## Task list

| ID  | Task                                                     | Status  | Verify                         |
| --- | -------------------------------------------------------- | ------- | ------------------------------ |
| 5.1 | `runtime-swap.ts` + audit worktree bracket               | done    | `bun test src/runtime.test.ts` |
| 5.2 | `initCodemap` / `configureResolver` throw on root switch | done    | runtime tests                  |
| 5.3 | `resetCodemapForTest` + `installCodemapTestTeardown`     | done    | —                              |
| 5.4 | Teardown rollout on `initCodemap` test suites            | done    | affected `*.test.ts`           |
| 5.5 | `loadUserConfig` → `parseCodemapUserConfig` at load      | done    | `bun test src/config.test.ts`  |
| 5.6 | `api.ts` + architecture: throws-on-root-switch           | done    | —                              |
| 5.s | Commit + PR + CI                                         | pending | `bun run check`                |

---

## Pre-locked decisions

| #    | Decision                                                                           |
| ---- | ---------------------------------------------------------------------------------- |
| P3.1 | Audit `--base` worktree reindex is the **only** exempt root switch (swap bracket). |
| P3.2 | `createCodemap({ root: B })` after root A **throws** — document breaking tighten.  |
| P3.3 | Teardown helper is maintainer-only; not a consumer surface.                        |

---

## Acceptance

- [ ] Second `initCodemap` with different root throws (audit exempt)
- [ ] Invalid explicit config fails at `loadUserConfig`
- [ ] Teardown on all `initCodemap` suites touched in PR
- [ ] PR merged to `main`

### Verify

```bash
bun test src/runtime.test.ts src/config.test.ts
bun run check
```

---

## Lifecycle

**Close when:** PR merged. Delete this file; lift to `docs/architecture.md`; update orchestrator session log.
