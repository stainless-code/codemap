---
name: pr-comment-fact-check
description: Triage and fact-check PR review comments against the actual codebase, project rules, and skills. Use when the user asks to address PR comments, respond to reviewer feedback, check if a comment is correct, fact-check a reviewer's claim, decide which comments to push back on, or sort hallucinated suggestions from real ones. Triggers on phrases like "check PR comments", "are these comments right", "review the PR feedback", "address comments on #N", "is the reviewer correct", "fact check this PR", "Bugbot/CodeRabbit/Copilot said X".
---

# PR comment fact-check

When a PR has reviewer comments (human or bot), don't apply suggestions reflexively. Each comment is a **claim about the code** that may be wrong, partial, outdated, or stylistic.

**The agent's job is to verify before acting.** Auto-applying suggestions from LLM reviewers (Bugbot, Copilot, Cursor's own bot, CodeRabbit) is the most common silent regression source — they confidently propose changes that contradict project conventions because they don't have the project context the human team has codified in skills/rules.

**Workflow:** [WORKFLOW.md](./WORKFLOW.md).

## Non-negotiables

1. **Never auto-apply suggestions** — every comment is a claim that must be verified against the actual code (`Read`), structural facts ([`codemap`](../codemap/SKILL.md)), authoritative project conventions (`.agents/rules` + skills), and toolchain signals (`bun run typecheck`, `bun run check`).
2. **Never reply "fixed!" without verifying** — that's how subtle bugs land. Apply, run the project's checks, then reply.
3. **Never dismiss a comment without evidence** — push-back is fine; evidence-free push-back wastes the reviewer's time.
4. **Categorize before acting** — sort into ✅ correct / ❌ hallucinated / ⚠️ partial / 🕒 outdated / 💭 style. Action defaults per category below.

| Verdict                      | What it means                                                                                                                                    | Default action                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| ✅ Correct                   | The code does/says what the reviewer claims; their suggestion improves it.                                                                       | Apply + **resolve thread**.                                                        |
| ⚠️ Partially correct         | Premise right, conclusion wrong (or vice versa).                                                                                                 | Apply salvageable part + reply explaining nuance; resolve only if reviewer agrees. |
| ❌ Incorrect (hallucination) | The code doesn't do what the reviewer claims, OR the reviewer cites a "best practice" that contradicts our actual rules / TS + library versions. | Push back with evidence; **leave unresolved** (merge-gate exception in WORKFLOW).  |
| 🕒 Outdated                  | The code already changed since the comment was posted.                                                                                           | Point at fix commit + **resolve**.                                                 |
| 💭 Style preference          | Not enforced by any lint rule or skill; subjective.                                                                                              | Apply if cheap + resolve; otherwise defer to author.                               |

## Hallucination catalog (scrutinize harder)

Common LLM-reviewer patterns on this repo. The codemap-shape ones (1–4) come from the codemap thesis — what Codemap deliberately is and isn't (per [`docs/why-codemap.md` § When to reach for something else](../../../docs/why-codemap.md#when-to-reach-for-something-else) and [`docs/roadmap.md` § Non-goals](../../../docs/roadmap.md#non-goals-v1)). The shape-5+ ones are universal across TS projects:

1. **"Just regex this"** when the file is in `src/parser.ts`, `src/css-parser.ts`, or `src/adapters/` — codemap is AST-backed by design (oxc for TS, lightningcss for CSS). Suggesting a regex replacement undoes the architectural choice. Verify against [`docs/architecture.md` § Parsers](../../../docs/architecture.md#parsers) before accepting.
2. **"Add full-text search"** — explicitly a non-goal per [`docs/roadmap.md` § Non-goals (v1)](../../../docs/roadmap.md#non-goals-v1). Push back with that anchor.
3. **"Add a daemon for performance"** — same; one-shot CLI is intentional, sub-100ms cold start makes a daemon unnecessary. Same non-goal anchor.
4. **"Index this column"** in `src/db.ts` — Codemap's SQLite schema is intentionally lean. Indexes are added when a query benchmark proves them necessary, not pre-emptively. Push back: ask for the query that's slow.
5. **Generic "best practice" claims** unsupported by our rules — "always destructure props at the top", "never use enums", "prefer interfaces over types" — these are stylistic and we either have a rule or we don't. Grep `.agents/rules/` and `.agents/skills/` first.
6. **"This isn't tested" without checking sibling test files OR golden fixtures** — codemap has unit tests under `src/**/*.test.ts` AND query-shape coverage under `fixtures/golden/`. A query change might be tested via golden-snapshot, not a `.test.ts`. Verify before accepting.
7. **Memory-leak / resource-leak claims with no concrete trigger** — "this could leak the SQLite handle" without a scenario is speculation; ask for the path. Codemap closes DB handles via the `using` pattern in most call sites — verify before accepting.
8. **Type-safety alarms** — if `tsgo --noEmit` (`bun run typecheck`) passes, the claim is almost always wrong (or about runtime behaviour the type system can't see, in which case the reviewer should justify with the runtime case).
9. **Convention citations that don't exist** — "This breaks our API conventions" — grep `.agents/` and `docs/` for the convention. If it's not codified, it's preference, not rule.
10. **Schema-bump / changeset alarms** — "this needs a minor changeset" — check [`.agents/lessons.md`](../../lessons.md) ("changesets bump policy"): pre-v1, default is patch unless the schema actually breaks `.codemap/index.db` (new tables/columns/`SCHEMA_VERSION` bump). Don't accept "minor for new CLI commands or public types".

## Anti-patterns

- **Don't apply every suggestion to clear the queue.** Each silently-applied wrong fix is a regression.
- **Don't reply with `"Good catch, fixed!"` without verifying.** That's how subtle bugs get introduced.
- **Don't dismiss without evidence.** Push-back is fine; evidence-free push-back wastes everyone's time and erodes trust.
- **Don't rebuild the same fact-check from scratch on every review round.** Save the verified state in a comment thread or in the PR description so subsequent rounds skip what's already settled.

## Reference

- Codemap (structural verification): [`codemap`](../codemap/SKILL.md).
- [`verify-after-each-step`](../../rules/verify-after-each-step.md) — run after applying a fix.
- [`harden-pr`](../harden-pr/SKILL.md) — optional full pass on the branch once triage is complete.
- [`docs/why-codemap.md`](../../../docs/why-codemap.md) and [`docs/roadmap.md` § Non-goals](../../../docs/roadmap.md#non-goals-v1) — canonical anchors for "this is a non-goal" push-backs (hallucination patterns 2–3 above).
- [`pr-comment-fact-check` rule](../../rules/pr-comment-fact-check.md) — Tier 1 priming layer that fires this skill on intent.
