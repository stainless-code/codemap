---
description: Sweep your own new comments at the end of every change. Keep what code can't say; cut the rest.
globs: "**/*.{ts,tsx,css,html,md}"
alwaysApply: true
---

# Concise Comments

After you finish a change — before reporting back — re-read the comments **you** authored in that turn. Keep only the ones that carry information the code itself cannot.

## Decision test

For every comment you wrote, ask: **"Could a teammate (human or AI) re-derive this from the code in under 30 seconds?"**

- **Yes** → delete it. The code is the documentation.
- **No** → keep it, slim to one sentence if possible.

## Keep

- **Why**, not what — design intent, trade-offs, the rejected alternative.
- **Non-obvious constraints** — SQLite quirks, parser idiosyncrasies, race conditions, ordering requirements.
- **Cross-references** that save grep time — `mirrors X`, `see NOTE(foo)`, `tracked at docs/roadmap.md § Y`.
- **Domain → code translations** — schema-column ↔ JS-field aliases, BE / external-API field aliases.
- **Sentinels and magic values** — `null because oxc-resolver returns null on unresolved`, `0 because SQLite rejects undefined`.

## Cut

- Restating the function/variable name (`/** Site id. */ sid: number`).
- Restating the next line of code (`// Reset to page 1` above `setPage(1)`).
- Generic library practice (`// Memoise this` above `useMemo`).
- Section headers in short files (`// === Helpers ===`).
- Author / date stamps (git tracks this).
- Multi-line prose where one clause does the job.

## Reconcile with `preserve-comments`

[`preserve-comments`](./preserve-comments.md) protects **existing** comments — never delete those without asking.

This rule applies only to comments **you authored in the current turn**. You own them; they earn their keep, or you cut them before handing the work back.

If you slim or delete a pre-existing comment, that requires explicit user confirmation per [`preserve-comments`](./preserve-comments.md) Rule 4 — this rule does not override that.

## When to sweep

- **Always before final report** — make it the last thing you do.
- **After every comment-touching edit during a long session** — don't accumulate noise across turns.
- **If you find yourself writing 3+ lines of prose for one decision** — stop, ask whether a one-liner with a code reference would do.

## Length budget (rule of thumb)

- **0 lines** — when the code is self-explanatory.
- **1 line** — default for kept comments.
- **2–3 lines** — only when context is genuinely irreducible (e.g. a parser-shape gotcha with two failure modes).
- **>3 lines** — extract to a `docs/` file and link to it.
