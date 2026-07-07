---
name: grilling
description: Relentlessly grill plans until shared understanding. Use when stress-testing a design or another skill delegates grilling.
---

# Grilling

Interview relentlessly about every aspect of a plan until shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. **For each question, provide a recommended answer.** Ask one question at a time.

## Rules

1. **One question at a time.** Wait for the user's answer before posing the next. Multi-question batches collapse the decision tree into a wall of text.
2. **Always recommend.** Every question carries your strongest read on the answer + a one-line "why". The user wants a sparring partner, not a menu.
3. **Explore before asking.** If the answer lives in source, use [`codemap query`](../codemap/SKILL.md) for structural facts, then `Read` / `Glob` **before** asking. Questions that the codebase already answers waste turns and signal weak prep.
4. **Walk dependencies, not breadth.** Resolve one branch fully before moving sideways. If Q3's answer makes Q5 moot, kill Q5; if Q3 forks into two new sub-questions, ask the sub-questions before returning to Q4.
5. **Push back on weak answers.** If the user's answer leaves the design ambiguous or contradicts something earlier, surface the conflict and re-pose. Don't accept "we'll see" — that's a Q for next time, not closure.
6. **Stop when the design is operational.** "Operational" means a competent contributor could open a PR from the resulting plan without further design questions. Not before, not after.

## Interaction shape

```text
Agent: <Q1>. My read: <recommended answer>. Why: <1-line reason>.
User:  <answer / pushback>
Agent: <Q2 — derived from Q1's answer>. My read: …
User:  …
Agent: That closes the design tree for me. Want me to <draft the plan / open a PR / start coding>?
```

Don't number the questions in chat — the conversation IS the order. Number them only when the user asks for a recap or a written summary.

## Codebase-exploration shortcuts

Reach for these before asking the human:

| Question shape                                  | Tool                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| "Where is X defined?" / "Who imports X?"        | [`codemap query`](../codemap/SKILL.md) · `Glob` (file paths)       |
| "What does file X export?"                      | `codemap query --recipe find-symbol-definitions` · `Read` the file |
| "What's the blast radius of X?"                 | `codemap impact` / `query_recipe fan-in`                           |
| "What conventions apply to this layer?"         | `Read` the relevant rule under `.agents/rules/`                    |
| "How does the existing similar module do this?" | `codemap query` for the pattern, then `Read`                       |

## Anti-patterns

- ❌ **Question dumps.** "I have 7 questions about this — (1) …, (2) …, (3) …" — the user can't keep state across 7 branches in one read.
- ❌ **Open-ended without a recommendation.** "What do you think about X?" — you're the senior here; lead.
- ❌ **Asking questions the codebase already answers.** "Does this module write to the `symbols` table?" — `codemap query` first.
- ❌ **Refusing to push back when the user says "I dunno".** "Don't know" is a signal to recommend harder, not to drop the branch.
- ❌ **Ending the session early.** If the next contributor would still ask "but what about X?", you stopped too soon.
