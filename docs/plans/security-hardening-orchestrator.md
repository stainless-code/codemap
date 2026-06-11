# Security hardening — task orchestrator

> **Status:** open · **Priority:** P2
>
> **Roadmap:** [§ Core substrate & platform](../roadmap.md#core-substrate--platform)
>
> **Motivator:** Unmerged hardening (query safety, HTTP bind, validate containment, impact homonyms, runtime isolation) split into **3 tracer-bullet PRs** with **one plan file each**.

---

## Agent start here

1. Read **§ PR schedule** below for status.
2. Open the **plan file** for the PR you are working on (implementation detail lives there).
3. Work **one PR at a time** from current `main`.
4. After merge: update **PR schedule** + **§ Session log** here; check acceptance in that PR's plan; close/delete that plan per its lifecycle.

**Program non-goals:** atomic `state-config` writes, golden `schema.test.ts` hardening (unless touching query-golden), `SCHEMA_VERSION` 40 debate, streaming git log parser.

---

## PR schedule

| PR    | Plan                                                            | Status                                                                              | Blocks                              |
| ----- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| **1** | lifted → [`architecture.md`](../architecture.md) (plan retired) | **merged** ([#180](https://github.com/stainless-code/codemap/pull/180) · `a5caca8`) | —                                   |
| **2** | lifted → [`architecture.md`](../architecture.md) (plan retired) | **merged** ([#181](https://github.com/stainless-code/codemap/pull/181) · `aae172f`) | —                                   |
| **3** | [`runtime-test-isolation.md`](./runtime-test-isolation.md)      | **in progress** (`fix/runtime-test-isolation`)                                      | PR **1** merged (PR **2** optional) |

| — | — | **deferred** | golden `schema.test.ts` + path guards |
| — | — | **skip** | atomic `ensureStateConfig` writes |

**Exit rule:** one PR = one tracer bullet; `bun run check` green; update this file before starting the next PR.

---

## ROI triage (program-level)

Evaluated 2026-06 against [roadmap § Floors](../roadmap.md#floors-v1-product-shape) and [Moat A](../roadmap.md#moats-load-bearing).

| Slice                                   | Roadmap                  | ROI          | PR    | Verdict |
| --------------------------------------- | ------------------------ | ------------ | ----- | ------- |
| `printFormattedQuery` → `queryRows`     | ✅ safety floor          | **Good** S   | **1** | Ship    |
| Non-loopback `serve` requires `--token` | ✅ HTTP floor            | **Good** S   | **1** | Ship    |
| `validate` `rejected` + symlink guard   | ✅ safety floor          | **Good** S   | **1** | Ship    |
| `impact` `inPath` homonym scoping       | ✅ Moat B read primitive | **Good** S–M | **2** | Ship    |
| Runtime root-switch guards + teardown   | ✅ one-root architecture | **Good** S–M | **3** | Ship    |
| Golden `schema.test.ts`                 | ⚠️ harness               | **Medium**   | —     | Defer   |
| Atomic `state-config` writes            | ❌                       | **Bad**      | —     | Skip    |

**Already on `main` (do not re-ship):** bug batch `54ad25a`, apply path containment `#112`, `query_only` on `queryRows`/`printQueryResult`, recipe CTE deny-list.

---

## Program decisions (all PRs)

| #   | Decision                                                                  |
| --- | ------------------------------------------------------------------------- |
| O.1 | Three PRs — security / impact / runtime independently reviewable.         |
| O.2 | No new verdict primitives — `rejected` is a validate row status (Moat A). |
| O.3 | Each PR ships only its plan scope — no drive-by refactors.                |

---

## Session log

| Date       | Event       | Notes                                                                         |
| ---------- | ----------- | ----------------------------------------------------------------------------- |
| 2026-06-10 | Triage      | ROI on 7 slices; 3-PR program adopted.                                        |
| 2026-06-10 | PR 1 impl   | PR **1** committed on `fix/security-hardening-wave1`; harden pass in flight.  |
| 2026-06-05 | PR 1 harden | `/harden-pr full` — plan retired; contracts in architecture/glossary.         |
| 2026-06-05 | PR 1 merge  | [#180](https://github.com/stainless-code/codemap/pull/180) → `a5caca8`.       |
| 2026-06-05 | PR 2 start  | `fix/impact-inpath-homonyms` — `inPath` + homonym walks in impact-engine.     |
| 2026-06-05 | PR 2 harden | `/harden-pr full` — plan retired; CLI/MCP/docs parity.                        |
| 2026-06-05 | PR 2 merge  | [#181](https://github.com/stainless-code/codemap/pull/181) → `aae172f`.       |
| 2026-06-05 | PR 3 start  | `fix/runtime-test-isolation` — root guards + test teardown + config validate. |
| —          | PR 3 merge  | _fill · close orchestrator_                                                   |

---

## Program lifecycle

**Close when:** PRs **1–3** merged (or remaining PRs explicitly deferred in roadmap with reason).

**On close:**

1. Delete this orchestrator + all three PR plan files.
2. Lift durable contracts to `docs/architecture.md`.
3. Remove or check off roadmap backlog bullet.
