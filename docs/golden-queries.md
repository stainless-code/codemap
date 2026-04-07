# Golden queries — design & policy

**Purpose:** Regression-test **Codemap internals** by comparing **`codemap query`** output to **checked-in expectations** (or subset matchers) on fixed corpora — **not** an LLM-in-the-loop eval. **Latency / tokens vs scanning:** [benchmark.md](./benchmark.md).

**Operational docs:** [CONTRIBUTING § Golden queries](../.github/CONTRIBUTING.md) · [benchmark § Fixtures](./benchmark.md#fixtures) · Runner: [scripts/query-golden.ts](../scripts/query-golden.ts) · Schema: [scripts/query-golden/schema.ts](../scripts/query-golden/schema.ts)

---

## Goals

| Goal                      | How scenarios help                               |
| ------------------------- | ------------------------------------------------ |
| **Catch regressions**     | Parser or schema drift → JSON diff vs golden     |
| **Encode good answers**   | Human-reviewed rows for representative queries   |
| **Stress realistic size** | Optional second corpus beyond `fixtures/minimal` |
| **Stay deterministic**    | Assertions on **query output**, not model prose  |

## Non-goals

- **Chat / SSE / auth** harnesses — out of scope here
- **Proving agents follow rules** — measure in the IDE or another project
- **Replacing** `src/benchmark.ts` — that stays **SQL vs glob/read time**; goldens add **correctness snapshots**

---

## How this fits other tooling

| Piece                     | Role                                                         |
| ------------------------- | ------------------------------------------------------------ |
| `fixtures/minimal/`       | Tier **A** corpus; stable for CI                             |
| `src/benchmark.ts`        | Speed comparison (not golden row equality)                   |
| `bun test`                | Unit tests for parsers, CLI, DB                              |
| `CODEMAP_ROOT` / `--root` | Index **any** tree; Tier **B** uses env + optional gitignore |

---

## No proprietary app code in this repo

We **do not** commit another product’s source tree, paths, business strings, or golden JSON **derived from** a private app (or any repo we do not own and license for redistribution).

| Safe to commit here                        | Not committed here                   |
| ------------------------------------------ | ------------------------------------ |
| **`fixtures/minimal/`** (trees we control) | Clones of private apps               |
| **Generic SQL** / **`--recipe`** ids       | App-specific path literals in assets |
| **Goldens** from **our** fixtures only     | Snapshots keyed to proprietary names |
| **Abstract `prompt` text** (intent labels) | Verbatim customer prompts            |

**Tier B:** Point `CODEMAP_ROOT` at a **local** clone; goldens for that tree stay **gitignored** (or private automation) — see [.gitignore](../.gitignore) and [benchmark § Tier B](./benchmark.md#fixtures).

---

## Tier model

| Tier            | Corpus                       | When                       | Purpose                                  |
| --------------- | ---------------------------- | -------------------------- | ---------------------------------------- |
| **A**           | `fixtures/minimal` (in-repo) | Every PR / `bun run check` | Fast, **committed** goldens              |
| **B**           | Local path via `CODEMAP_*`   | Maintainer machine         | Scale; goldens **optional / gitignored** |
| **B′** (future) | Public OSS fixture only      | CI optional                | Larger committed corpus if license OK    |

---

## Scenario shape (implemented)

Scenarios live in **`fixtures/golden/scenarios.json`** (Tier A) or optional **`scenarios.external.json`** / **example** (Tier B). Each entry has **`id`**, **`sql` or `recipe`**, optional **`match`** (`exact`, `minRows`, `everyRowContains`), optional **`budgetMs`**. Goldens: **`fixtures/golden/minimal/*.json`** etc. Refresh: **`bun scripts/query-golden.ts --update`**.

**Prompts** in JSON are **intent labels**, not pasted chat logs — pair with queries whose literals come from **fixture-owned** data (see [fixtures/qa/prompts.external.template.md](../fixtures/qa/prompts.external.template.md) for optional chat QA).

---

## Status

| Area                          | State                                                                   |
| ----------------------------- | ----------------------------------------------------------------------- |
| Tier A runner + CI            | **`bun run test:golden`** in `check`                                    |
| Tier B external + schema      | **`test:golden:external`**, Zod in **`scripts/query-golden/schema.ts`** |
| Subset matchers + budgets     | **`match`**, **`budgetMs`**, **`--strict-budget`**                      |
| Optional CI for public corpus | Deferred — [roadmap § Backlog](./roadmap.md#backlog)                    |

---

## References

- [benchmark.md](./benchmark.md) — speed methodology, Tier B, fixtures
- [architecture.md](./architecture.md) — schema, parsers
- [roadmap.md](./roadmap.md) — backlog
