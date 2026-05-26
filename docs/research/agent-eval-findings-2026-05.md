# Agent eval — MCP vs traditional agent tools (2026-05)

> **Status:** open evaluation · **Created:** 2026-05-26
>
> **Canonical harness:** [benchmark § Agent eval harness](../benchmark.md#agent-eval-harness) · **Roadmap:** [§ Backlog — falsifiable benchmark CI](../roadmap.md#backlog) (named external fixtures for market-facing numbers)
>
> **Purpose:** Capture methodology and exploratory findings for Codemap MCP vs grep/read/glob agent workflows. Deterministic harness numbers are reproducible; dual-agent and self-index sessions are documented here until scripted.

---

## 1. Eval layers

| Layer          | What it measures                                         | MCP-off arm                        | Reproducible?                                                                                                   |
| -------------- | -------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Probe**      | `queryRows` vs simulated glob→read→grep                  | Traditional regex probe in harness | Yes — `bun run test:agent-eval`                                                                                 |
| **Live**       | `handleQuery` / `handleQueryRecipe` vs traditional probe | Same traditional arm               | Yes — `bun run test:agent-eval` (live smoke) + local `AGENT_EVAL_MODE=live bash scripts/agent-eval/run-arms.sh` |
| **Log**        | Exported MCP-on vs MCP-off session transcripts           | Post-hoc parse only                | Yes when logs are supplied                                                                                      |
| **Dual-agent** | Real LLM agent with MCP vs same tasks with MCP forbidden | Agent uses Grep/Read/Glob only     | Manual / ad hoc today; not in CI                                                                                |

The harness **traditional arm** models **naive** file discovery (glob, read every candidate, grep). A **skilled** agent may grep directly and match MCP on simple lookups — see § 4.

---

## 2. Pinned sample — `fixtures/minimal` (live mode)

Reproduce:

```bash
AGENT_EVAL_MODE=live AGENT_EVAL_PRINT_SUMMARY=1 bash scripts/agent-eval/run-arms.sh
```

Corpus: [`fixtures/minimal`](../fixtures/minimal/) · Probes: [`scripts/agent-eval/scenarios.json`](../scripts/agent-eval/scenarios.json) · Output: `.agent-eval/comparison.json` (gitignored).

Captured **2026-05-26** (live MCP handlers, `runs=1`, all three probes succeeded):

| Scenario                     | MCP-on tools | MCP-off tools | MCP-on est. tokens | MCP-off est. tokens |
| ---------------------------- | ------------ | ------------- | ------------------ | ------------------- |
| `symbol-usePermissions`      | 1            | 25            | 53                 | 2,591               |
| `dependencies-from-consumer` | 1            | 25            | 173                | 2,697               |
| `find-call-sites`            | 1            | 25            | 375                | 2,667               |
| **Totals**                   | **3**        | **75**        | **601**            | **7,955**           |

**Est. tokens** use the harness formula: `ceil((prompt chars + payload chars) / 4)`. MCP-off payload includes bytes read plus grep hit JSON; live MCP-on includes tool name, args, and handler JSON (recipe probes use `query_recipe`).

These numbers are **structural cost on a tiny fixture**, not a market claim. External repos (zod, fastify, …) remain the roadmap target before surfacing headline figures in `MARKETPLACE.md`.

---

## 3. Dual-agent study (codemap self-index)

Same four structural tasks, two subagents on the **codemap repo** index (not `fixtures/minimal`):

1. Call path `createCodemap` → `resolveStateDir`
2. Transitive dependents of `src/db.ts` within depth 4
3. Rename preview `resolveStateDir` → `resolveStateDirectory` (touch points)
4. Upstream callers of `resolveStateDir` within 2 call hops

| Arm         | Structural tool calls          | Est. payload | Notes                                                                |
| ----------- | ------------------------------ | ------------ | -------------------------------------------------------------------- |
| **MCP-on**  | 6 MCP (+ schema reads)         | ~38 KB       | Ground truth from index; 2 retries (impact direction, rename params) |
| **MCP-off** | 37 (21 grep, 13 read, 3 shell) | ~85 KB       | Built static import graph; medium confidence on tasks 2 and 4        |

**Task outcomes:**

| Task             | MCP-on                             | MCP-off                       | Verdict                                      |
| ---------------- | ---------------------------------- | ----------------------------- | -------------------------------------------- |
| Call path        | 2 hops, 1 MCP call                 | Same path, 8 tools            | Tie on answer; MCP cheaper                   |
| Transitive deps  | **132 files**                      | 124–133 (scope-dependent)     | MCP exact; no-MCP approximate                |
| Rename preview   | **8 code files** (21 binding refs) | 11 files (+ docs, comments)   | MCP matches `rename-preview` recipe scope    |
| Upstream callers | **28 symbols**, 6 depth-1          | ~28 (text-inferred), 23 tools | Similar count; MCP 1 call, higher confidence |

---

## 4. Findings (provisional)

1. **Naive discovery vs skilled grep** — Harness MCP-off (75 tools on minimal) models glob→read→grep. A skilled agent doing targeted grep can tie MCP on **tool count** for simple symbol/import/call-site lookups.
2. **Graph questions favor MCP** — Transitive deps, impact, trace, rename-preview: MCP returns indexed graph answers in 1–2 calls; grep/read chains cost more tools and bytes and often report medium confidence.
3. **Token estimate nuance** — Recipe payloads with `actions` metadata can make MCP **larger** than grep on simple tasks; MCP still wins on **correctness** (resolved edges, column-precise call sites, binding kinds).
4. **Dual-agent > simulation** — Hand-waving grep token math understates real agent cost (re-reads, shell graph scripts, scope ambiguity). Prefer dual-agent or log mode for “real agent” claims.
5. **Not an LLM eval** — None of these layers measure model reasoning quality or task success rate with an LLM in the loop; they measure **structural tool cost** and answer alignment with the index.

---

## 5. Limitations

- **Corpus-dependent** — Minimal fixture magnifies MCP-off read fan-out; large repos may differ in absolute numbers but graph tasks remain index-shaped.
- **Schema drift** — Re-run after `SCHEMA_VERSION` or fixture changes; do not treat captured rows as CI baselines until golden-scored.
- **Self-index sessions** — Dual-agent runs on the codemap repo are exploratory, not pinned in CI.
- **Log mode** — Token counts omit full read payloads unless the export includes them; prefer live/probe arms for payload-inclusive comparison.

---

## 6. Follow-up (not shipped)

- **Scripted dual-agent harness** — Task JSON, golden expected answers, spawn MCP-on / MCP-off agents, score tool count + answer diff (extends `scripts/agent-eval/`, dev-only).
- **External fixture CI** — [roadmap § Backlog](../roadmap.md#backlog): zod, fastify, vue-core, next.js with published numbers in [benchmark.md](../benchmark.md).
- **Log capture helper** — Not shipped; log comparison today uses manually exported transcripts + `compare-live-logs.ts` / `AGENT_EVAL_LOG_ON`/`OFF`.

When dual-agent is scripted and external fixtures land, lift durable methodology into [benchmark § Agent eval harness](../benchmark.md#agent-eval-harness) and close or slim this note per [docs-governance](../README.md#closing-research).
