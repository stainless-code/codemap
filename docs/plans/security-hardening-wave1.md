# PR 1 — query / serve / validate hardening

> **Status:** open (committed, PR pending) · **PR:** 1 of 3 · **Effort:** S
>
> **Orchestrator:** [`security-hardening-orchestrator.md`](./security-hardening-orchestrator.md)
>
> **Motivator:** Close last CLI `query_only` gap on formatted query output; require auth on non-loopback `serve`; reject unsafe paths in `validate`. Roadmap safety floors — not new product verbs.

---

## Agent start here

### Key touchpoints

| File                                  | What                                |
| ------------------------------------- | ----------------------------------- |
| `src/cli/cmd-query.ts`                | `printFormattedQuery` → `queryRows` |
| `src/cli/cmd-query-formatted.test.ts` | SARIF DML guard E2E                 |
| `src/cli/cmd-serve.ts`                | `isLoopbackHost`, token gate        |
| `src/application/path-containment.ts` | `pathTraversesSymlinkOutsideRoot`   |
| `src/application/validate-engine.ts`  | `rejected` status                   |
| `docs/architecture.md`                | Query / HTTP / validate wiring      |

### Architecture

```text
codemap query --format sarif|…
  → printFormattedQuery → queryRows (PRAGMA query_only = 1)

codemap serve --host 0.0.0.0
  → parseServeRest: require --token when !isLoopbackHost(host)

codemap validate <paths>
  → computeValidateRows → rejectValidatePath
      → pathEscapesProjectRoot | pathTraversesSymlinkOutsideRoot → status rejected
```

---

## Task list

| ID  | Task                                                       | Status      | Verify                                              |
| --- | ---------------------------------------------------------- | ----------- | --------------------------------------------------- |
| 1.1 | `printFormattedQuery` → `queryRows`                        | **done**    | `bun test src/cli/cmd-query-formatted.test.ts`      |
| 1.2 | `cmd-query-formatted.test.ts`                              | **done**    | same                                                |
| 2.1 | `isLoopbackHost` + non-loopback `--token` required         | **done**    | `bun test src/cli/cmd-serve.test.ts`                |
| 2.2 | Serve tests updated                                        | **done**    | same                                                |
| 3.1 | `pathTraversesSymlinkOutsideRoot`, `resolvePathWithinRoot` | **done**    | `bun test src/application/path-containment.test.ts` |
| 3.2 | `validate` `rejected` + `rejectValidatePath`               | **done**    | `bun test src/cli/cmd-validate.test.ts`             |
| 3.3 | Test `../../../etc/passwd` → `rejected`                    | **done**    | same                                                |
| 1.x | `docs/architecture.md` lift                                | **done**    | `bun run format:check`                              |
| 1.s | Commit + PR + CI                                           | **pending** | `bun run check` (committed; PR + CI open)           |

---

## Pre-locked decisions

| #    | Decision                                                                  |
| ---- | ------------------------------------------------------------------------- |
| P1.1 | Formatted CLI paths use `queryRows` — completes CHANGELOG #107 hardening. |
| P1.2 | Loopback bind: token optional; non-loopback: token mandatory.             |
| P1.3 | `rejected` is per-row status with `reason` — not a global verdict.        |

---

## Acceptance

- [x] `codemap query --format sarif "DELETE FROM …"` errors without mutating `files` count
- [x] `codemap serve --host 0.0.0.0` errors without `--token`
- [x] `computeValidateRows(..., ["../../../etc/passwd"])` → `rejected` + reason
- [x] Architecture docs updated
- [ ] PR merged to `main`

### Verify

```bash
bun test src/cli/cmd-query-formatted.test.ts src/cli/cmd-serve.test.ts src/cli/cmd-validate.test.ts src/application/path-containment.test.ts
bun run check
```

---

## Lifecycle

**Close when:** PR merged. Delete this file; lift contracts to `docs/architecture.md`; update [`security-hardening-orchestrator.md`](./security-hardening-orchestrator.md) session log.
