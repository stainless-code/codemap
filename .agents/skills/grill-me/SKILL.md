---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
disable-model-invocation: true
---

Run a [`grilling`](../grilling/SKILL.md) session. Structural exploration uses [`codemap query`](../codemap/SKILL.md) per the [`codemap` rule](../../rules/codemap.md) — not `Grep`.

When agreement crystallises on a question that affects an in-flight `docs/plans/<name>.md`, write the answer into the plan inline as you go — don't batch them up. The plan doc is the durable record; the chat transcript is not.

For plan + inline repo docs (glossary, architecture lifts): [`grill-with-docs`](../grill-with-docs/SKILL.md).
