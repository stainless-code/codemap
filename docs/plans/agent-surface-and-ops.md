# Agent surface & indexing ops — plan index

> **Status:** open · **Created:** 2026-05-24
>
> **Purpose:** Prioritized work queue for agent UX, MCP ergonomics, indexing reliability, and TS/JS graph substrate gaps. Each item has its own plan file; this index links priority tiers and recommended ship order.
>
> **Roadmap home:** [§ Backlog — Agent & indexing ops](../roadmap.md#agent--indexing-ops)

---

## Recommended ship order

```
P0 (ops polish, ~2 weeks total)
  mcp-server-instructions → wsl-watch-policy → git-hook-auto-sync → mcp-tool-allowlist

P1 (agent + reliability, parallel tracks)
  Track A: mcp-trace-explore-tools (+ call-path recipes)
  Track B: agents-init-mcp-wiring
  Track C: index-lock-and-error-log → parse-worker-hardening
  Track D: affected-tests-recipe
  Track E: field-qualified-search
  Track F: agent-eval-harness (after MCP instructions + allowlist)

P2 (substrate + trigger-gated)
  c9-plugin-layer (existing XL plan) → framework-route-extraction
  unresolved-calls-staging → callback-dispatch-synthesis
  call-path-type-hierarchy-recipes (extends P1 recipes)
  fts-default-on-evaluation (measurement gate)
  cross-project-mcp-root (on demand)
```

---

## P0 — Quick wins

| Plan                                                    | Effort | Summary                                           |
| ------------------------------------------------------- | ------ | ------------------------------------------------- |
| [mcp-server-instructions](./mcp-server-instructions.md) | S      | MCP initialize playbook for tool selection        |
| [wsl-watch-policy](./wsl-watch-policy.md)               | S      | Disable broken watcher on WSL `/mnt` mounts       |
| [git-hook-auto-sync](./git-hook-auto-sync.md)           | S      | Opt-in git hooks for background incremental index |
| [mcp-tool-allowlist](./mcp-tool-allowlist.md)           | S      | `CODEMAP_MCP_TOOLS` env subset registration       |

---

## P1 — Medium effort

| Plan                                                      | Effort | Summary                                            |
| --------------------------------------------------------- | ------ | -------------------------------------------------- |
| [mcp-trace-explore-tools](./mcp-trace-explore-tools.md)   | M      | MCP trace/explore/node + recipe twins              |
| [agents-init-mcp-wiring](./agents-init-mcp-wiring.md)     | M      | `agents init --mcp` config + permissions           |
| [affected-tests-recipe](./affected-tests-recipe.md)       | M      | Test selection from dep graph + stdin              |
| [index-lock-and-error-log](./index-lock-and-error-log.md) | M      | Cross-process lock + `codemap unlock` + errors.log |
| [parse-worker-hardening](./parse-worker-hardening.md)     | M      | Per-file timeout + worker recycle                  |
| [field-qualified-search](./field-qualified-search.md)     | M      | `kind:` / `path:` / `name:` search → SQL           |
| [agent-eval-harness](./agent-eval-harness.md)             | M      | A/B agent eval for tool-call + token metrics       |

---

## P2 — Strategic bets

| Plan                                                                      | Effort | Summary                                               |
| ------------------------------------------------------------------------- | ------ | ----------------------------------------------------- |
| [framework-route-extraction](./framework-route-extraction.md)             | L      | Express / React Router / NestJS → `http_routes` table |
| [callback-dispatch-synthesis](./callback-dispatch-synthesis.md)           | L      | Heuristic call edges with `provenance` column         |
| [unresolved-calls-staging](./unresolved-calls-staging.md)                 | L      | Two-phase call resolution queue                       |
| [cross-project-mcp-root](./cross-project-mcp-root.md)                     | M      | Optional `root` on MCP tools + DB cache               |
| [fts-default-on-evaluation](./fts-default-on-evaluation.md)               | S–M    | Measure size tax; maybe flip default                  |
| [call-path-type-hierarchy-recipes](./call-path-type-hierarchy-recipes.md) | M      | `type-ancestors` / descendants recipes                |

---

## Related existing plans

| Plan                                                          | Relationship                                                                      |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [c9-plugin-layer](./c9-plugin-layer.md)                       | Prerequisite for [framework-route-extraction](./framework-route-extraction.md)    |
| [github-marketplace-action](./github-marketplace-action.md)   | May add `affected` mode after [affected-tests-recipe](./affected-tests-recipe.md) |
| [perf-triangulation-rollout](./perf-triangulation-rollout.md) | [parse-worker-hardening](./parse-worker-hardening.md) related Phase 3 items       |

---

## Moat checklist (all items)

- **Moat A:** Every new CLI/MCP verb has a recipe or SQL equivalent (or is pure transport wiring).
- **Moat B:** Substrate additions (`http_routes`, `unresolved_calls`, `calls.provenance`) enable new JOINs — not verdict primitives.
- **Floors:** No LLM-in-box, no telemetry, no opaque graph-only APIs.
