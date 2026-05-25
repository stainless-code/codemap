# Agent surface delivery — PR tracker

> **Status:** in flight · **Created:** 2026-05-25
>
> **Purpose:** Map [`agent-surface-and-ops`](./agent-surface-and-ops.md) plans to concrete PRs, parallelization rules, and current status so work can pause/resume outside any single agent session.
>
> **Plan index:** [agent-surface-and-ops.md](./agent-surface-and-ops.md) · **Roadmap:** [§ Agent & indexing ops](../roadmap.md#agent--indexing-ops)

---

## Quick resume

| Next action                 | Detail                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| **In review (merge-ready)** | [#138](https://github.com/stainless-code/codemap/pull/138) — field-qualified search (PR 7) |
| **Start next**              | **PR 9** — `agent-eval-harness` (last P1) after #138 merges                                |
| **Recently merged**         | [#135](https://github.com/stainless-code/codemap/pull/135) — agents init `--mcp` (PR 8)    |

Update the table below when a PR merges or a new branch opens.

---

## Recommended shape: 2 P0 PRs + 5–6 P1 PRs

Merge each PR to `main` directly. No long-lived integration branch (`feat/agent-ops`).

### Wave 1 — P0 (~1 week wall clock, 2 PRs)

| PR    | Plans bundled                                                                                               | Status | Branch / link                                              | Notes                                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **1** | [`mcp-server-instructions`](./mcp-server-instructions.md) + [`mcp-tool-allowlist`](./mcp-tool-allowlist.md) | merged | [#126](https://github.com/stainless-code/codemap/pull/126) | Same hot files (`mcp-server.ts`, `agent-content`); ~3–4 days                                                                |
| **2** | [`wsl-watch-policy`](./wsl-watch-policy.md) → [`git-hook-auto-sync`](./git-hook-auto-sync.md)               | merged | [#127](https://github.com/stainless-code/codemap/pull/127) | `watch-policy.ts` first; hooks reference it in diagnostics. Lock deferred to PR 3 — note concurrent hook + MCP in PR 2 body |

### Wave 2 — P1 (~2–3 weeks, parallel tracks)

Max **3 parallel tracks** at once.

| PR    | Plans                                                                                                                                          | Status | Blocked by                                                                                                             | Parallel with |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| **3** | [`index-lock-and-error-log`](./index-lock-and-error-log.md) → [`parse-worker-hardening`](./parse-worker-hardening.md) (stack)                  | merged | [#129](https://github.com/stainless-code/codemap/pull/129), [#130](https://github.com/stainless-code/codemap/pull/130) | 4, 5          |
| **4** | Recipe half of [`mcp-trace-explore-tools`](./mcp-trace-explore-tools.md) (`call-path`, `symbol-neighborhood` SQL + tests)                      | merged | [#131](https://github.com/stainless-code/codemap/pull/131)                                                             | 3, 5          |
| **5** | [`affected-tests-recipe`](./affected-tests-recipe.md) (+ Phase 2 MCP `affected` in [#133](https://github.com/stainless-code/codemap/pull/133)) | merged | [#132](https://github.com/stainless-code/codemap/pull/132), [#133](https://github.com/stainless-code/codemap/pull/133) | 3, 4          |

| **6** | MCP half of trace (`trace` / `explore` / `node` tools) + update instructions | merged | [#134](https://github.com/stainless-code/codemap/pull/134) | PR 1, PR 4 |
| **7** | [`field-qualified-search`](./field-qualified-search.md) | merge-ready | [#138](https://github.com/stainless-code/codemap/pull/138) | PR 1, PR 6 |
| **8** | [`agents-init-mcp-wiring`](./agents-init-mcp-wiring.md) | merged | [#135](https://github.com/stainless-code/codemap/pull/135) | 3–5 |
| **9** | [`agent-eval-harness`](./agent-eval-harness.md) | planned | PR 1, PR 8 (merged), allowlist | **last P1** — start after PR 7 or in parallel |

**Parallelization constraints**

- **Do not parallelize PR 6 + PR 7** — both edit MCP `show` schema; stack or single PR.
- **PR 2 + PR 3** — land lock (PR 3) before documenting hook+lock behavior, or follow up with a doc-only commit.
- **One owner for `agents-init-*`** — git-hooks (P0) and MCP wiring (P1) touch the same files; stack if both active.

### Wave 3 — P2 (separate epic, trigger-gated)

Do not rush with P0/P1. **2–4 separate PRs** after P1 completes.

| Item               | Plan                                                                                                                           | Gate                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Framework routes   | [`framework-route-extraction`](./framework-route-extraction.md)                                                                | Blocked on [`c9-plugin-layer`](./c9-plugin-layer.md) (XL) |
| Call substrate     | [`callback-dispatch-synthesis`](./callback-dispatch-synthesis.md), [`unresolved-calls-staging`](./unresolved-calls-staging.md) | One at a time (schema + parser)                           |
| FTS default        | [`fts-default-on-evaluation`](./fts-default-on-evaluation.md)                                                                  | Measurement-only; solo PR anytime                         |
| Cross-project root | [`cross-project-mcp-root`](./cross-project-mcp-root.md)                                                                        | On demand                                                 |

---

## Execution playbook

1. **Branch from fresh `main` per PR** — rebase often; avoid long-lived feature branches.
2. **Combine same-file P0 items** — e.g. MCP instructions + allowlist = one PR.
3. **Recipe-before-MCP for trace tools** — split `templates/recipes/` from `mcp-server.ts` (PR 4 before PR 6).
4. **One owner for `agents-init-*`** — stack git-hooks and MCP wiring if both in flight.
5. **Land index-lock before parse-worker hardening** — worker timeouts write to `errors.log`.
6. **Agent eval last** — `scripts/agent-eval/` is dev-only and depends on MCP surface + init wiring.
7. **Tracer bullets per PR** — each PR shippable + tested per repo conventions.

### If you want maximum speed (solo or 2 people)

| Week | PRs                              | Outcome                        |
| ---- | -------------------------------- | ------------------------------ |
| 1    | 1 + 2                            | P0 complete                    |
| 2    | 3 + 4 + 5 (parallel)             | Reliability + recipe substrate |
| 3    | 6 + 8 (parallel), then 7, then 9 | MCP tools + init + eval        |

---

## Maintaining this doc

When opening or merging a PR:

1. Update **Quick resume** and the relevant row **Status** (`planned` → `open` → `merged`).
2. On merge, check off the matching items in [`roadmap.md`](../roadmap.md#agent--indexing-ops).
3. Close individual plan files per [docs-governance](../../.agents/skills/docs-governance/SKILL.md) when the feature ships.

Status values: `planned` · `open` · `merged` · `cancelled`
