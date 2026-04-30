---
description: Tier 1 priming — when the user asks about PR comments, reviewer feedback, or addressing review threads, fact-check each comment as a claim about the code before acting. Fires the pr-comment-fact-check skill on intent triggers like "address PR comments", "Bugbot said X", "is the reviewer correct".
alwaysApply: true
---

# PR comment fact-check (priming)

When the user asks about PR comments, reviewer feedback, or addressing review threads — **STOP**. Each comment is a **claim about the code**, not an instruction to apply. Run the [`pr-comment-fact-check`](../skills/pr-comment-fact-check/SKILL.md) skill before reflexively applying or dismissing.

## Trigger phrases

This rule fires on intent, not files. Watch for any of:

- "address PR comments" / "respond to comments on #N"
- "fact-check the PR" / "are these comments right"
- "Bugbot said X" / "Copilot suggested Y" / "Cursor bot left feedback" / "CodeRabbit flagged Z"
- "review the PR feedback" / "triage comments" / "what should I push back on"
- A pasted reviewer comment + "should I apply this?"

## The non-negotiables

1. **Never auto-apply suggestions** — every comment is a claim that must be verified against the actual code (`Read`), structural facts ([`codemap`](../skills/codemap/SKILL.md)), authoritative project conventions (`.agents/rules` + skills), and toolchain signals (`bun run typecheck`, `bun run check`).
2. **Never reply "fixed!" without verifying** — that's how subtle bugs land. Apply, run the project's checks, then reply.
3. **Never dismiss a comment without evidence** — push-back is fine; evidence-free push-back wastes the reviewer's time.
4. **Categorize before acting** — sort into ✅ correct / ❌ hallucinated / ⚠️ partial / 🕒 outdated / 💭 style. Action defaults per category:
   - **✅ correct** — apply + **resolve thread**.
   - **❌ hallucinated** — reply with evidence (file:line, rule reference, codemap query result); **leave unresolved** (auto-resolving rejection is dismissive).
   - **⚠️ partial** — apply salvageable part + reply explaining the nuance; resolve only if the reviewer agrees.
   - **🕒 outdated** — point at the fix commit + **resolve thread**.
   - **💭 style** — apply if cheap + **resolve**, otherwise defer to author.

## Why this is Tier 1, not Tier 2

The trigger is workflow-driven (user says the magic phrase), not file-driven. There's no glob for "you are now in PR-comment-triage mode". An always-on priming rule is the only attachment mode that fires reliably on the intent.

The cost is ~30 lines of always-on context. The benefit is preventing the single most common LLM-reviewer failure mode: silently changing correct code to match a confidently-wrong critique because the bot didn't have the project context the codified rules / skills carry.

## Reference

Full workflow (commands, query patterns, hallucination catalog, reply templates): [`.agents/skills/pr-comment-fact-check/SKILL.md`](../skills/pr-comment-fact-check/SKILL.md).

Related:

- [`agents-tier-system`](./agents-tier-system.md) — the framework that justified pairing this skill with a rule (skill has hard "never" clauses → deserves a rule).
- [`docs-governance`](./docs-governance.md) — fact-checking comments about docs uses the same lifecycle / cross-ref discipline (Rule 7 anchor preservation, etc.).
