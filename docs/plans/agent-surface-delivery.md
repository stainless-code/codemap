# Agent surface delivery — PR tracker

> **Status:** in flight · **Created:** 2026-05-25
>
> **Purpose:** Map [`agent-surface-and-ops`](./agent-surface-and-ops.md) plans to concrete PRs, parallelization rules, and current status so work can pause/resume outside any single agent session.
>
> **Plan index:** [agent-surface-and-ops.md](./agent-surface-and-ops.md) · **Roadmap:** [§ Agent & indexing ops](../roadmap.md#agent--indexing-ops)

---

## Quick resume

| Next action         | Detail                                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Open**            | Live MCP agent-eval arms + optional external nightly — [agent-eval-harness.md](./agent-eval-harness.md) |
| **Recently merged** | [#139](https://github.com/stainless-code/codemap/pull/139) — agent-eval probe harness (PR 9)            |
|                     | [#138](https://github.com/stainless-code/codemap/pull/138) — field-qualified search (PR 7)              |
|                     | Wave 1–2 (#126–#137) — see merged rows below; plan tombstones removed per docs-governance               |

Update the table below when a PR merges or a new branch opens.

---

## Recommended shape: 2 P0 PRs + 5–6 P1 PRs

Merge each PR to `main` directly. No long-lived integration branch (`feat/agent-ops`).

### Wave 1 — P0 (~1 week wall clock, 2 PRs)

| PR    | Plans bundled                                    | Status | Branch / link                                              | Notes                                                                                                                       |
| ----- | ------------------------------------------------ | ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **1** | MCP instructions + `CODEMAP_MCP_TOOLS` allowlist | merged | [#126](https://github.com/stainless-code/codemap/pull/126) | Same hot files (`mcp-server.ts`, `agent-content`); ~3–4 days                                                                |
| **2** | WSL watch policy → git-hook auto-sync            | merged | [#127](https://github.com/stainless-code/codemap/pull/127) | `watch-policy.ts` first; hooks reference it in diagnostics. Lock deferred to PR 3 — note concurrent hook + MCP in PR 2 body |

### Wave 2 — P1 (~2–3 weeks, parallel tracks)

Max **3 parallel tracks** at once.

| PR    | Plans                                                                                                 | Status                                                                              | Blocked by                                                                                                             | Parallel with |
| ----- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------- |
| **3** | Index lock + `errors.log` → parse-worker hardening (stack)                                            | merged                                                                              | [#129](https://github.com/stainless-code/codemap/pull/129), [#130](https://github.com/stainless-code/codemap/pull/130) | 4, 5          |
| **4** | `call-path` + `symbol-neighborhood` recipes                                                           | merged                                                                              | [#131](https://github.com/stainless-code/codemap/pull/131)                                                             | 3, 5          |
| **5** | `affected-tests` recipe + MCP `affected` ([#133](https://github.com/stainless-code/codemap/pull/133)) | merged                                                                              | [#132](https://github.com/stainless-code/codemap/pull/132), [#133](https://github.com/stainless-code/codemap/pull/133) | 3, 4          |
| **6** | MCP `trace` / `explore` / `node` + instructions update                                                | merged                                                                              | [#134](https://github.com/stainless-code/codemap/pull/134)                                                             | PR 1, PR 4    |
| **7** | Field-qualified `show --query` search                                                                 | merged                                                                              | [#138](https://github.com/stainless-code/codemap/pull/138)                                                             | PR 1, PR 6    |
| **8** | `agents init --mcp` wiring                                                                            | merged                                                                              | [#135](https://github.com/stainless-code/codemap/pull/135)                                                             | 3–5           |
| **9** | [`agent-eval-harness`](./agent-eval-harness.md) — probe slice                                         | merged ([#139](https://github.com/stainless-code/codemap/pull/139)); live arms open | —                                                                                                                      | PR 1, PR 8    |

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

1. Update **Quick resume** and the relevant row **Status** (`planned` → `open` → `merged` / partial).
2. On merge of a **shipped** Wave item: **delete** its plan file and lift any unique ops detail to [`agents.md`](../agents.md) / [`architecture.md`](../architecture.md); **prune** matching `[x]` lines from [`roadmap.md`](../roadmap.md#agent--indexing-ops) per [docs-governance Rule 2](../../.agents/skills/docs-governance/SKILL.md) (do not leave completed checkboxes in the backlog).
3. **Keep** plan files while work is partial (e.g. agent-eval probe shipped, live arms open) — update status header and acceptance checkboxes instead of deleting.

Status values: `planned` · `open` · `merged` · `partial` · `cancelled`
