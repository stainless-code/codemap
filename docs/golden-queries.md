# Golden queries — design & policy

**Purpose:** Regression-test **Codemap internals** by comparing **`codemap query`** output to **checked-in expectations** (or subset matchers) on fixed corpora — **not** an LLM-in-the-loop eval. **Latency / tokens vs scanning:** [benchmark.md](./benchmark.md).

**Operational docs:** [CONTRIBUTING § Golden queries](../.github/CONTRIBUTING.md) · [benchmark § Fixtures](./benchmark.md#fixtures) · [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness) (agent-eval harness — probe + live — reuses scenarios via `goldenId`) · Runner: [scripts/query-golden.ts](../scripts/query-golden.ts) · Setup: [scripts/query-golden/run-setup.ts](../scripts/query-golden/run-setup.ts) · Schema: [scripts/query-golden/schema.ts](../scripts/query-golden/schema.ts)

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

| Piece                     | Role                                                                        |
| ------------------------- | --------------------------------------------------------------------------- |
| `fixtures/minimal/`       | Tier **A** corpus; stable for CI                                            |
| `scripts/agent-eval/`     | Tier **A** agent-eval harness (`test:agent-eval`; reuses golden `goldenId`) |
| `src/benchmark.ts`        | Speed comparison (not golden row equality)                                  |
| `bun test`                | Unit tests for parsers, CLI, DB                                             |
| `CODEMAP_ROOT` / `--root` | Index **any** tree; Tier **B** uses env + optional gitignore                |

---

## No proprietary app code in this repo

We **do not** commit another product’s source tree, paths, business strings, or golden JSON **derived from** a private app (or any repo we do not own and license for redistribution).

| Safe to commit here                        | Not committed here                   |
| ------------------------------------------ | ------------------------------------ |
| **`fixtures/minimal/`** (trees we control) | Clones of private apps               |
| **Generic SQL** / **`--recipe`** ids       | App-specific path literals in assets |
| **Goldens** from **our** fixtures only     | Snapshots keyed to proprietary names |
| **Abstract `prompt` text** (intent labels) | Verbatim customer prompts            |

**Tier B:** Point `CODEMAP_ROOT` at a **local** clone; goldens for that tree stay **gitignored** (or private automation) — see [.gitignore](../.gitignore). For agent-eval on external fixtures, see [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness) and [`.github/workflows/agent-eval-external.yml`](../.github/workflows/agent-eval-external.yml).

---

## Tier model

| Tier                       | Corpus                                   | When                       | Purpose                                                                                                                                                          |
| -------------------------- | ---------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A (in-repo test bench)** | `fixtures/minimal` + `fixtures/golden/`  | Every PR / `bun run check` | **Canonical** for Codemap development — see [fixtures/README.md](../fixtures/README.md)                                                                          |
| **B (consumer-only)**      | Local path via `CODEMAP_*`               | Private app validation     | Goldens **gitignored** — not required to develop Codemap                                                                                                         |
| **Bench growth**           | `fixtures/minimal` + `CAPABILITIES.json` | Shipped (Phases 1–3)       | [testing-coverage.md](./testing-coverage.md), [fixtures/README.md](../fixtures/README.md); optional scale: [roadmap.md](./roadmap.md) (in-repo test bench scale) |

---

## Scenario shape (implemented)

Scenarios live in **`fixtures/golden/scenarios.json`** (Tier A) or optional **`scenarios.external.json`** / **example** (Tier B). The file may be a **bare array** of scenarios (legacy) or an object `{ "setup": [...], "scenarios": [...] }`. Optional top-level **`setup`** runs once after index, before scenarios — today only **`{ "kind": "ingest-coverage", "path": "<relative-to-fixture>" }`** (see [run-setup.ts](../scripts/query-golden/run-setup.ts)); missing coverage files are skipped with a warning. Each scenario has **`id`**, **`sql` or `recipe`**, optional **`match`** (`exact`, `minRows`, `everyRowContains`), optional **`budgetMs`**. Goldens: **`fixtures/golden/minimal/*.json`** etc. Refresh: **`bun scripts/query-golden.ts --update`**.

**Prompts** in JSON are **intent labels**, not pasted chat logs — pair with queries whose literals come from **fixture-owned** data (see [fixtures/qa/prompts.external.template.md](../fixtures/qa/prompts.external.template.md) for optional chat QA).

### Evidence columns (high-judgment recipes)

Some bundled recipes add optional **`reason`** (TEXT) and **`evidence_json`** (TEXT, JSON array) columns on each row — factual detection path for agents, not engine verdicts (Moat A — not pass/fail verdicts). Bounded subqueries cap evidence at three hops; list caps append `{"truncated":true}`. `unimported-exports` reasons: `no_direct_import`, `reexport_chain_possible`, `unresolved_import_blind_spot`. Goldens assert these columns when the recipe ships evidence (`boundary-violations`, `deprecated-symbols`, `unimported-exports`).

### Coverage columns (CRAP / enrichment recipes)

`high-crap-score` adds **`coverage_source`** (`measured` \| `estimated`) and **`effective_coverage_pct`** on each row — measured when `coverage` has a matching symbol row after `ingest-coverage`; otherwise graph-estimated tiers from test reachability. Goldens assert `coverage_source` when the recipe ships coverage semantics (`high-crap-score`); measured override is covered by `scripts/high-crap-score-measured.test.mjs`.

---

## Status

| Area                          | State                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tier A runner + CI            | **`bun run test:golden`** + **`bun run test:agent-eval`** in `check` (CI Test job runs both; agent-eval reuses golden index when present)                                                                                                                                                                        |
| Tier A scenario coverage      | Scenarios cover core parser/schema surfaces, every bundled recipe (`templates/recipes/*.sql`), and SQL pin-down for substrate tables — see [testing-coverage.md](./testing-coverage.md). Guard: `scripts/query-golden-coverage-matrix.test.mjs`. Inventory: [scenarios.json](../fixtures/golden/scenarios.json). |
| Tier B external + schema      | **`test:golden:external`**, Zod in **`scripts/query-golden/schema.ts`**                                                                                                                                                                                                                                          |
| Subset matchers + budgets     | **`match`**, **`budgetMs`**, **`--strict-budget`**                                                                                                                                                                                                                                                               |
| Optional CI for public corpus | Deferred — [roadmap § Backlog](./roadmap.md#backlog)                                                                                                                                                                                                                                                             |

---

## References

- [benchmark.md](./benchmark.md) — speed methodology, Tier B, fixtures
- [architecture.md](./architecture.md) — schema, parsers
- [roadmap.md](./roadmap.md) — backlog
