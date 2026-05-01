---
name: improve-codebase-architecture
description: Find deepening opportunities in the codebase, informed by the domain language in docs/glossary.md and the architecture in docs/architecture.md. Use when the user wants to improve architecture, find refactoring opportunities, consolidate tightly-coupled modules, or make a codebase more testable and AI-navigable.
---

# Improve Codebase Architecture

Surface architectural friction and propose **deepening opportunities** — refactors that turn shallow modules into deep ones. The aim is testability and AI-navigability.

## Glossary

Use these terms exactly in every suggestion. Consistent language is the point — don't drift into "component," "service," "API," or "boundary." Full definitions in [LANGUAGE.md](LANGUAGE.md).

- **Module** — anything with an interface and an implementation (function, class, package, slice).
- **Interface** — everything a caller must know to use the module: types, invariants, error modes, ordering, config. Not just the type signature.
- **Implementation** — the code inside.
- **Depth** — leverage at the interface: a lot of behaviour behind a small interface. **Deep** = high leverage. **Shallow** = interface nearly as complex as the implementation.
- **Seam** — where an interface lives; a place behaviour can be altered without editing in place. (Use this, not "boundary.")
- **Adapter** — a concrete thing satisfying an interface at a seam.
- **Leverage** — what callers get from depth.
- **Locality** — what maintainers get from depth: change, bugs, knowledge concentrated in one place.

Key principles (see [LANGUAGE.md](LANGUAGE.md) for the full list):

- **Deletion test**: imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity reappears across N callers, it was earning its keep.
- **The interface is the test surface.**
- **One adapter = hypothetical seam. Two adapters = real seam.**

This skill is _informed_ by the project's domain model. The domain language in [`docs/glossary.md`](../../../docs/glossary.md) gives names to good seams; the layering described in [`docs/architecture.md`](../../../docs/architecture.md) records the structural decisions the skill should not re-litigate.

## Process

### 1. Explore

Read [`docs/glossary.md`](../../../docs/glossary.md) (canonical domain terms) and the relevant section of [`docs/architecture.md`](../../../docs/architecture.md) (canonical layering / wiring) first.

Then walk the codebase via [`codemap`](../codemap/SKILL.md) — the structural SQLite index. Per the [`codemap` rule](../../rules/codemap.md), querying the index beats grepping for symbol-shaped questions:

```bash
codemap query --json "SELECT name, signature, file_path FROM symbols WHERE file_path LIKE 'src/cli/%' AND kind = 'function'"
codemap query --json "SELECT from_path, COUNT(*) AS deps FROM dependencies GROUP BY from_path ORDER BY deps DESC LIMIT 10"
codemap query --json -r barrel-files
```

Don't follow rigid heuristics — explore organically and note where you experience friction:

- Where does understanding one concept require bouncing between many small modules?
- Where are modules **shallow** — interface nearly as complex as the implementation?
- Where have pure functions been extracted just for testability, but the real bugs hide in how they're called (no **locality**)?
- Where do tightly-coupled modules leak across their seams?
- Which parts of the codebase are untested, or hard to test through their current interface?

Apply the **deletion test** to anything you suspect is shallow: would deleting it concentrate complexity, or just move it? A "yes, concentrates" is the signal you want.

### 2. Present candidates

Present a numbered list of deepening opportunities. For each candidate:

- **Files** — which files/modules are involved
- **Problem** — why the current architecture is causing friction
- **Solution** — plain English description of what would change
- **Benefits** — explained in terms of locality and leverage, and also in how tests would improve

**Use [`docs/glossary.md`](../../../docs/glossary.md) vocabulary for the domain, and [LANGUAGE.md](LANGUAGE.md) vocabulary for the architecture.** If the glossary defines `barrel file`, talk about "the barrel-file detection module" — not "the FooBarHandler," and not "the barrel service."

**Architecture conflicts**: if a candidate contradicts [`docs/architecture.md` § Layering](../../../docs/architecture.md#layering), only surface it when the friction is real enough to warrant revisiting that layering. Mark it clearly (e.g. _"contradicts architecture.md § Layering — but worth reopening because…"_). Don't list every theoretical refactor the layering forbids.

Do NOT propose interfaces yet. Ask the user: "Which of these would you like to explore?"

### 3. Grilling loop

Once the user picks a candidate, drop into a grilling conversation (per [`grill-me`](../grill-me/SKILL.md)). Walk the design tree with them — constraints, dependencies, the shape of the deepened module, what sits behind the seam, what tests survive.

Side effects happen inline as decisions crystallize:

- **Naming a deepened module after a concept not in `docs/glossary.md`?** Add the term to the glossary right there per [`docs/README.md` Rule 9](../../../docs/README.md). Disambiguations (TS shape vs SQL table, etc.) take priority.
- **Sharpening a fuzzy term during the conversation?** Update `docs/glossary.md` right there.
- **Surfacing a structural decision worth recording?** If the candidate becomes a planned refactor, draft `docs/plans/<topic>.md` per [`docs/README.md` Rule 3](../../../docs/README.md). Codemap doesn't ship ADRs — decisions of record lift into [`docs/architecture.md`](../../../docs/architecture.md) on ship per [`docs/README.md` Rule 2](../../../docs/README.md), and the plan file is deleted.
- **Want to explore alternative interfaces for the deepened module?** See [INTERFACE-DESIGN.md](INTERFACE-DESIGN.md).
- **Sub-rules for what counts as a "deepening" candidate**: see [DEEPENING.md](DEEPENING.md).
