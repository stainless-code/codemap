---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time, waiting for feedback before continuing.

If a question can be answered by exploring the codebase, explore the codebase instead. In this repo, that means querying [`codemap`](../codemap/SKILL.md) (the structural index) before reaching for `Grep` or `Read` — see the [`codemap` rule](../../rules/codemap.md).

When agreement crystallises on a question that affects an in-flight `docs/plans/<name>.md`, write the answer into the plan inline as you go — don't batch them up. The plan doc is the durable record; the chat transcript is not.
