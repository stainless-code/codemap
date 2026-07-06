# Grill-with-docs — artifacts and session rules

Companion to the user-invoked [`grill-with-docs`](./SKILL.md) wrapper. Run [`grilling`](../grilling/SKILL.md) first; follow [`docs-governance`](../docs-governance/SKILL.md) for paths.

## Doc-governance shape this skill writes into

This repo is **Tier B only** — one repo-wide `docs/` surface, no per-feature subtrees. Mapping from a generic `CONTEXT.md` + `docs/adr/` template to ours:

| Generic template concept              | This repo's equivalent                                                                                                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONTEXT.md` (canonical vocabulary)   | [`docs/glossary.md`](../../../docs/glossary.md) (repo-root, single)                                                                                                                                                                        |
| `docs/adr/<n>-<slug>.md` (decisions)  | **No ADRs.** Current decisions live in [`docs/architecture.md`](../../../docs/architecture.md); closed historical decisions in `docs/audits/<YYYY-MM-DD>-<topic>.md`; in-flight in `docs/plans/<name>.md`. See § Where decisions go below. |
| `CONTEXT-MAP.md` (multi-context repo) | n/a — single repo-wide context; cross-cutting linkage lives in `docs/architecture.md`                                                                                                                                                      |

No feature `docs/` to bootstrap — there's one surface. If `docs/glossary.md` doesn't exist yet, create it the first time a term crystallises (per [`domain-modeling`](../domain-modeling/SKILL.md)).

## Process

### 1. Pre-flight — load the existing language and decisions

Before asking the first question, read (or `codemap query` for structural facts, then `Read` for prose):

- **[`docs/glossary.md`](../../../docs/glossary.md)** — what does the project already call the things in this conversation?
- **[`docs/architecture.md`](../../../docs/architecture.md)** — has a similar decision already shipped? What constraints does it impose on this one?
- **`docs/audits/<topic>.md`** — has the team already considered (and rejected) a similar shape? Don't re-litigate without evidence.
- **[`docs/roadmap.md`](../../../docs/roadmap.md)** — is this thread already on the backlog? Cite the existing entry.
- **`docs/plans/<name>.md`** — is there an open plan that overlaps?

Skip whichever files don't exist. Don't bootstrap a doc just to read it.

### 2. Run the grilling loop

Follow the [`grilling`](../grilling/SKILL.md) rules (one question at a time, recommend, explore, push back, dependency-walk). When a term or boundary crystallises, invoke [`domain-modeling`](../domain-modeling/SKILL.md) inline — update [`docs/glossary.md`](../../../docs/glossary.md) per the mapping table above.

On top, fire these triggers as they come up:

#### 2a. Challenge against the glossary

When the user uses a term that **conflicts with `docs/glossary.md`**, call it out immediately:

> `docs/glossary.md` defines **recipe** as cataloged SQL loaded from `templates/recipes/<id>.{sql,md}`. You just said "the query" for ad-hoc SQL in the CLI — that's a **query**, not a recipe. Do you mean a new recipe id or free-form SQL?

If the term is **missing from `docs/glossary.md`** but is genuinely domain-bearing (a new noun / verb the user is introducing — e.g. a new schema column or MCP tool), flag it for a same-PR glossary entry — don't wait for the work to ship.

#### 2b. Sharpen fuzzy language

When the user uses overloaded or vague terms, propose a precise canonical term and (if applicable) add the alias to `docs/glossary.md`'s "Aliases / avoid" column:

> You're saying "the file table" — do you mean the **`files` SQLite table** (on-disk rows in `.codemap/index.db`) or the **`FileRow` TS shape** returned by insert helpers in `src/db.ts`? `docs/glossary.md` keeps those distinct; let's pick one for this plan.

#### 2c. Stress-test with concrete scenarios

When domain relationships are being discussed, invent specific scenarios that probe edge cases:

> If a homonym symbol exists in two files and the new recipe scopes by `name` only, does `codemap apply rename-preview` union both definitions or require `define_in`? What does fan-in look like when one file is a barrel and the other is a hub?

The point is to force the user to be precise about boundaries between concepts.

#### 2d. Cross-reference with code

When the user states how something works, check whether the code agrees. Use `codemap query` / [`codemap`](../codemap/SKILL.md) for structural facts before `Read`. If you find a contradiction, surface it:

> You said recipe params are always string-keyed. But `query_recipe` accepts typed JSON in the MCP layer — does your plan preserve that contract for HTTP too?

If the user is wrong, the answer changes. If the code is wrong, you've found a bug — surface it as a separate concern.

### 3. Write decisions back into the docs inline

Don't batch up doc edits for the end. Capture them as they happen:

| Decision shape                                                                                                                  | Where it lands                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A new term is resolved** (or an existing one sharpened)                                                                       | Update [`docs/glossary.md`](../../../docs/glossary.md) on the same PR.                                                                                                                                                                                                                                                     |
| **A current architectural decision is locked in** (e.g. "new adapter earns a factory only when it needs real language mapping") | Capture in the **plan file** (`docs/plans/<name>.md`) while in-flight. When the plan ships, lift the rationale into [`docs/architecture.md`](../../../docs/architecture.md) per [`docs-governance` § Closing a plan](../docs-governance/SKILL.md). Don't write to `architecture.md` directly while the plan is still open. |
| **A historical decision needs to be recorded** (rejected alternative, surprising trade-off)                                     | Two paths: (1) part of an in-flight plan → record it in the plan's § Open questions; the lift moment carries it to `architecture.md` or `audits/`. (2) Standalone → append to `docs/audits/<YYYY-MM-DD>-<topic>.md` (create the dated file if substantial enough).                                                         |
| **A future-work item surfaces**                                                                                                 | One line in [`docs/roadmap.md`](../../../docs/roadmap.md) under the appropriate section.                                                                                                                                                                                                                                   |
| **An ambiguity stays unresolved**                                                                                               | Flag it in `docs/glossary.md`'s § Flagged ambiguities section (don't quietly resolve). Don't bury the ambiguity in the plan body alone — the glossary is where readers look for term meaning.                                                                                                                              |

### 4. Where decisions go (the no-ADR convention)

This repo deliberately doesn't carry `docs/adr/` — that surface is doubled by `docs/architecture.md` (current shipping decisions) + `docs/audits/` (closed historical record). **Skip the ADR offer entirely**. Instead:

- **"Want me to record this so future architecture reviews don't re-suggest it?"** → for in-flight work, add it to the plan's § Open questions (with the chosen branch); for shipped work, add it to `docs/architecture.md` § `<relevant section>` with the rationale; for closed-and-rejected alternatives, the entry goes in `docs/audits/<topic>.md`.
- **Hard-to-reverse architectural shape** (e.g. "new recipe id ships bundled + documented in glossary") → Plan § Open question + `architecture.md` at lift time.
- **Surprising deviations** (e.g. "golden scenarios stay Tier A in CI — external corpus is Tier B only") → If this is the _durable rationale_, it belongs in `architecture.md` and is cited from maintainer docs. Don't duplicate.

If the user explicitly asks "should we file an ADR for this?", the answer is "no — this repo's `architecture.md` + `audits/` are the equivalent. Want me to add the entry there?"

### 5. Stop conditions

Same as [`grilling`](../grilling/SKILL.md): stop when a competent contributor could open the PR from the resulting plan. **Plus**:

- [`docs/glossary.md`](../../../docs/glossary.md) is updated with every new term resolved during the session.
- Open questions in the plan have either an answer or an explicit "deferred — needs `<X>`" with a named blocker.
- The plan file's § References section links back to the relevant `architecture.md` / `audits/<topic>.md` sections that informed the decisions.

## Checklist (run before declaring done)

- [ ] Read `docs/glossary.md`, `docs/architecture.md`, `docs/audits/` before the first question (or noted "n/a — none exist yet" and created the missing reference doc as part of the session)
- [ ] Every new domain term resolved during the session is in `docs/glossary.md` on the same PR
- [ ] Every locked-in design decision is captured in the plan file (or `architecture.md` if standalone)
- [ ] Every rejected alternative the future explorer needs is captured (plan § Open questions or `audits/`, never lost)
- [ ] Every future-work item surfaced is one line in `roadmap.md`
- [ ] No ADR file was created (we don't use that pattern — see § 4)
- [ ] No `glossary.md` term was quietly re-defined; ambiguities went into § Flagged ambiguities

## Reference

- [`domain-modeling`](../domain-modeling/SKILL.md) · [`improve-codebase-architecture`](../improve-codebase-architecture/SKILL.md) · [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md)
