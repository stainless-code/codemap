---
name: ask-agents
description: Which user-only agent workflow to run — grilling, docs-aware grilling, teaching, or meta authoring help.
disable-model-invocation: true
---

# Ask agents (router)

Zero context load — you pick the workflow.

## The main flow: idea → ship

1. **`/grill-with-docs`** — sharpen the idea; inline updates to `docs/` (architecture / roadmap / glossary / plans) as decisions land. No codebase yet? Use **`/grill-me`** (standalone below).
2. **Branch — multi-session build?**
   - **Yes** → capture plan in **`docs/plans/<name>.md`** → split into GitHub issues. Fresh session per issue.
   - **No** → tracer bullets + **`tdd`** + workflow skills appropriate to this repo in the same window.
3. **`/harden-pr`** — lite after each tracer slice; full before PR ready.

### Context hygiene

Keep grilling + plan authoring in **one window** until issues are filed. Each implement session starts fresh from the plan/issue. If the window nears the smart zone, write a compact plan in `docs/plans/`.

## Codebase health (not feature work)

- **`/improve-codebase-architecture`** — surface deepening opportunities; pick one → back to main flow at grill-with-docs.
- **`/diagnosing-bugs`** — hard bugs and perf regressions (model-invoked skill — not a router target).
- Periodic hygiene: **`/docs-lifecycle-sweep`** on `docs/` (model-invoked).

## Crossing sessions

- **`/compact`** — built-in: same session, summarized history — use only at phase breaks.
- **Fresh session** — start from `docs/plans/<name>.md` or the GitHub issue.

## Standalone

| Invoke                                                         | When                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`grill-me`](../grill-me/SKILL.md)                             | Sharpen a plan with **no** codebase (stateless)                          |
| [`writing-great-skills`](../writing-great-skills/SKILL.md)     | Skill vocabulary + principles                                            |
| [`writing-agents-config`](../writing-agents-config/SKILL.md)   | Codemap repo tier/pairing deltas                                         |
| [`domain-modeling`](../domain-modeling/SKILL.md)               | Ubiquitous language inline + batch glossary                              |
| [`tdd`](../tdd/SKILL.md)                                       | RED→GREEN tracer-bullet TDD                                              |
| [`verify-after-each-step`](../verify-after-each-step/SKILL.md) | Per-file checks after each milestone                                     |
| [`diagnosing-bugs`](../diagnosing-bugs/SKILL.md)               | Debug loop for hard bugs                                                 |
| [`teach`](../teach/SKILL.md)                                   | Multi-session learning workspace (missions, lessons, retrieval practice) |

Meta: [`agents-tier-system`](../agents-tier-system/SKILL.md).
