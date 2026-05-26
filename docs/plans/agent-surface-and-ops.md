# Agent surface & indexing ops — plan index

> **Status:** partial (Wave 1–2 + probe eval shipped; live agent-eval arms open) · **Created:** 2026-05-24
>
> **Purpose:** Prioritized work queue for agent UX, MCP ergonomics, indexing reliability, and TS/JS graph substrate gaps. Open items have plan files; shipped Wave 1–2 work lives in [agents.md](../agents.md) and the PR tracker.
>
> **Roadmap home:** [§ Backlog — Agent & indexing ops](../roadmap.md#agent--indexing-ops)
>
> **PR tracker (pause/resume):** [agent-surface-delivery.md](./agent-surface-delivery.md)

---

## Shipped (Wave 1–2, #126–#138)

MCP initialize instructions + `codemap://mcp-instructions`, `CODEMAP_MCP_TOOLS`, WSL `/mnt` watch policy, opt-in git-hook auto-sync, MCP `trace` / `explore` / `node`, `agents init --mcp`, `affected-tests` + MCP `affected`, cross-process `index.lock` + `codemap unlock` + `errors.log`, parse-worker timeout/recycle, field-qualified `show --query`.

Details: [agents.md](../agents.md). Merge history: [agent-surface-delivery.md](./agent-surface-delivery.md).

---

## P1 — Open

| Plan                                          | Effort | Summary                                                                                        |
| --------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| [agent-eval-harness](./agent-eval-harness.md) | M      | Probe A/B + PR CI ([#139](https://github.com/stainless-code/codemap/pull/139)); live arms open |

---

## P2 — Strategic bets

| Plan                                                            | Effort | Summary                                               |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| [framework-route-extraction](./framework-route-extraction.md)   | L      | Express / React Router / NestJS → `http_routes` table |
| [callback-dispatch-synthesis](./callback-dispatch-synthesis.md) | L      | Heuristic call edges with `provenance` column         |
| [unresolved-calls-staging](./unresolved-calls-staging.md)       | L      | Two-phase call resolution queue                       |
| [cross-project-mcp-root](./cross-project-mcp-root.md)           | M      | Optional `root` on MCP tools + DB cache               |
| [fts-default-on-evaluation](./fts-default-on-evaluation.md)     | S–M    | Measure size tax; maybe flip default                  |

---

## Related existing plans

| Plan                                                          | Relationship                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [c9-plugin-layer](./c9-plugin-layer.md)                       | Prerequisite for [framework-route-extraction](./framework-route-extraction.md)                               |
| [github-marketplace-action](./github-marketplace-action.md)   | May add `affected` mode (shipped CLI/MCP `affected` + `affected-tests` recipe)                               |
| [perf-triangulation-rollout](./perf-triangulation-rollout.md) | Parse-worker hardening shipped #130; Phase 3 deferrals remain in rollout plan                                |
| [type-heritage-substrate](./type-heritage-substrate.md)       | Lifts [#141](https://github.com/stainless-code/codemap/pull/141) recipe limits via `type_heritage` substrate |

---

## Moat checklist (all items)

- **Moat A:** Every new CLI/MCP verb has a recipe or SQL equivalent (or is pure transport wiring).
- **Moat B:** Substrate additions (`http_routes`, `unresolved_calls`, `calls.provenance`) enable new JOINs — not verdict primitives.
- **Floors:** No LLM-in-box, no telemetry, no opaque graph-only APIs.
