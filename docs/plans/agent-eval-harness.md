# Agent eval harness — plan

> **Status:** open · **Priority:** P1 · **Effort:** M (~2 weeks)
>
> **Motivator:** Codemap claims agent-discovery wins ([why-codemap.md](../why-codemap.md), [benchmark.md](../benchmark.md)) but CI only gates query latency and golden SQL. Need falsifiable A/B: agent with MCP vs without, measuring tool-call count and tokens on fixed tasks.
>
> **Roadmap:** [§ Backlog](../roadmap.md#backlog) (falsifiable benchmark item) · [agent-surface-and-ops § P1](./agent-surface-and-ops.md#p1)

---

## Pre-locked decisions

| #   | Decision                                                                                                              | Source                                         |
| --- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| L.1 | Harness lives in **`scripts/agent-eval/`** — not shipped in npm package.                                              | Dev/CI only                                    |
| L.2 | Fixtures reuse **golden-query scenarios** + optional external public repos (zod, fastify) per roadmap benchmark item. | Don't duplicate fixtures                       |
| L.3 | Arms: **codemap MCP on** vs **off** (or [mcp-tool-allowlist](./mcp-tool-allowlist.md) subset).                        | Clean ablation                                 |
| L.4 | Metrics: tool-call sequence, wall time, estimated tokens (chars/4), success bit.                                      | Publishable table                              |
| L.5 | **No telemetry upload** — results written to local JSON + optional CI artifact.                                       | [Floor](../roadmap.md#floors-v1-product-shape) |

---

## Implementation steps

1. **`scripts/agent-eval/run-arms.sh`** — orchestrate N runs per arm
2. **Probe scripts** — structured tasks mirroring golden queries ("find symbol X", "who imports Y", "fan-in top 10")
3. **Parser for agent logs** — extract tool names from Claude/Cursor export format (start with one agent)
4. **Summary reporter** — markdown table for docs/benchmark.md
5. **CI job** — optional nightly or manual `workflow_dispatch` (public fixtures only)
6. **Link to [mcp-tool-allowlist](./mcp-tool-allowlist.md)** for minimal-tool arms

---

## Acceptance

- [x] One-command local run produces comparison JSON (`bash scripts/agent-eval/run-arms.sh`)
- [x] At least 3 scenarios covered (`scripts/agent-eval/scenarios.json`)
- [x] Documented methodology section in benchmark.md
- [ ] CI job — optional nightly or manual `workflow_dispatch` (public fixtures only)
- [ ] Live agent A/B arms with MCP allowlist subset

---

## Dependencies

- [mcp-server-instructions](./mcp-server-instructions.md) and [agents-init-mcp-wiring](./agents-init-mcp-wiring.md) improve arm fairness (agents actually use tools)
