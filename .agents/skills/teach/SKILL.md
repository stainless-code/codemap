---
name: teach
description: Structured multi-session teaching — missions, lessons, retrieval practice.
disable-model-invocation: true
argument-hint: "What would you like to learn about?"
---

# Teach

The user wants to **learn something over multiple sessions**. This is stateful — progress lives in files in a **teaching workspace**, not in chat memory alone.

## Teaching workspace

**Default location:** `teach/<topic-slug>/` at the repo root (never inside `src/` package code). User may choose another directory — treat **that directory** as the workspace root.

**Git:** workspaces are **personal by default** — do not commit `teach/**` unless the user explicitly wants shared onboarding material in the repo (add it to `.gitignore` otherwise).

State files at workspace root:

| File / folder             | Purpose                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `MISSION.md`              | Why they're learning — grounds every lesson. [MISSION-FORMAT.md](./MISSION-FORMAT.md)          |
| `GLOSSARY.md`             | Canonical terms once understood. [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md)                    |
| `RESOURCES.md`            | High-trust knowledge + community sources. [RESOURCES-FORMAT.md](./RESOURCES-FORMAT.md)         |
| `NOTES.md`                | User teaching preferences, scratchpad                                                          |
| `./learning-records/*.md` | Decision-grade insights (ADR-shaped). [LEARNING-RECORD-FORMAT.md](./LEARNING-RECORD-FORMAT.md) |
| `./lessons/*.html`        | Primary teaching unit — one scoped win per file (`0001-slug.html`, increment)                  |
| `./reference/*.html`      | Compressed cheat sheets for revisit (syntax, flows, glossaries)                                |
| `./assets/*`              | Reusable lesson components (stylesheet first)                                                  |

Create directories lazily when first needed.

## Codemap repo topics

When the mission is **this codebase** (index, recipes, schema, parsers, adapters, agents init, rules/skills):

1. **Explore before lecturing** — query [`codemap`](../codemap/SKILL.md) (the structural SQLite index) for symbol-shaped questions before `Grep`/`Read`; read `src/`, `docs/`, `.agents/` for narrative.
2. **Domain language** — read [`docs/glossary.md`](../../../docs/glossary.md) and [`docs/architecture.md`](../../../docs/architecture.md); align lesson terms (FileRow vs `files` table, recipe vs query, schema vs DDL, hub vs barrel).
3. **Cite symbols and paths** — not line numbers (they drift). Link to `.agents/skills/<name>/SKILL.md` or concrete `src/` paths; use `codemap query` results for symbol references.
4. **RESOURCES.md** — include repo docs ([`AGENTS.md`](../../../AGENTS.md), relevant skills, [`docs/architecture.md`](../../../docs/architecture.md), [`docs/glossary.md`](../../../docs/glossary.md)) alongside external sources.

General topics (Rust, yoga, etc.): **never trust parametric knowledge** until `RESOURCES.md` is populated.

## Philosophy

Three layers: **Knowledge** (trusted resources) · **Skills** (interactive lessons + feedback loops) · **Wisdom** (communities, real-world practice).

Split **fluency** (in-session recall) vs **storage strength** (long-term retention). Design for storage: retrieval practice, spacing, interleaving (skills only).

## Lessons

- One self-contained **HTML** file per lesson — clean, short, one tangible win tied to `MISSION.md`.
- Link to other lessons / reference docs via anchors.
- Cite a primary external resource per lesson when possible.
- End with: ask the agent follow-up questions — you're the teacher.
- Open the lesson file for the user when possible (`open ./lessons/0001-….html` on macOS).

Before authoring: read `./assets/`; **reuse is default**. Shared stylesheet is the first component every workspace earns — every lesson links it so the course looks consistent. When a lesson needs something reusable (quiz widget, diagram helper), add it to `./assets/` and link — never inline code a second lesson would duplicate.

## Mission first

If `MISSION.md` is empty or vague, **interview the user** (one question at a time; recommend an answer) before writing lessons. Revise mission only after user confirms — record shift in a learning record.

## Zone of proximal development

Read `learning-records/`, mission, and glossary → teach the next thing that challenges **just enough**. User may name a topic directly.

## Knowledge vs skills

Lessons target a **skill**; include only knowledge required for it. Knowledge from `RESOURCES.md` with citations. Skills via quizzes / guided steps with **tight feedback loops**. Quiz options: equal word count when possible (no formatting clues).

## Wisdom

For questions needing real-world judgment, answer then point to **communities** in `RESOURCES.md`. Respect if user opts out of communities — note in `RESOURCES.md`.

## Reference documents

Compress lesson essence into `./reference/*.html` for revisit. Glossaries live in `GLOSSARY.md` at workspace root — adhere to terms in all lessons.

## Related skills

- Interview mission / plan: [`grilling`](../grilling/SKILL.md)
- Project-aware plan + docs: [`grill-with-docs`](../grill-with-docs/SKILL.md)
- Domain terminology: [`domain-modeling`](../domain-modeling/SKILL.md)
