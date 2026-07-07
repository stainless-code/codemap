---
name: domain-modeling
description: Build and sharpen the project's domain terminology inline or via a batch glossary scan. Use when pinning down ubiquitous language, recording a domain decision, grill-with-docs crystallises a term, or refreshing docs/glossary.md.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. Reading [`docs/glossary.md`](../../../docs/glossary.md) for vocabulary is a one-line habit any skill can do — **this skill is for when you're changing the model**, not just consuming it.

Codemap deltas for this repo:

- **No repo-root `docs/adr/`** — current decisions live in [`docs/architecture.md`](../../../docs/architecture.md); closed history in `docs/audits/<topic>.md`; in-flight in `docs/plans/<name>.md`. See [`docs-governance`](../docs-governance/SKILL.md).
- **Single canonical glossary** — [`docs/glossary.md`](../../../docs/glossary.md) at the repo root (Tier B: one repo-wide surface, no per-feature subtrees). See [`grill-with-docs/ARTIFACTS.md`](../grill-with-docs/ARTIFACTS.md).

## File structure

```
/
├── docs/
│   ├── glossary.md          ← canonical ubiquitous language (single)
│   ├── architecture.md      ← current structural decisions
│   ├── audits/<topic>.md    ← closed decisions
│   └── plans/<name>.md      ← in-flight decisions
```

Create files lazily — only when you have something to write.

## During the session (inline)

### Challenge against the glossary

When the user uses a term that conflicts with [`docs/glossary.md`](../../../docs/glossary.md), call it out immediately.

### Sharpen fuzzy language

When the user uses vague or overloaded terms (e.g. "query" for both a cataloged recipe and ad-hoc SQL, or "file" for both a `FileRow` TS shape and the `files` SQLite table), propose a precise canonical term.

### Discuss concrete scenarios

Stress-test domain relationships with specific edge-case scenarios (homonym symbols across files, recipe vs ad-hoc query drift, hub vs barrel ranking, fan-in vs fan-out impact direction).

### Cross-reference with code

When the user states how something works, check whether the code agrees (`src/db.ts`, `src/parser.ts`, recipe loader, adapter layer). Surface contradictions — use `codemap query` for structural facts before `Read`/`Grep`.

### Update vocabulary inline

When a term is resolved, update [`docs/glossary.md`](../../../docs/glossary.md) **right there** — don't batch. Use [GLOSSARY-ENTRY.md](./GLOSSARY-ENTRY.md).

`docs/glossary.md` is **glossary only** — no implementation details, not a spec or scratch pad.

### Offer decision docs sparingly

Only when the decision is hard to reverse, surprising without context, and the result of a real trade-off. Route to `architecture.md`, `plans/`, or `audits/` per docs-governance — not ADRs at repo root.

## Batch glossary scan

When the user asks to extract or refresh the full glossary (not one term at a time), follow [GLOSSARY-SCAN.md](./GLOSSARY-SCAN.md).

**Done when:** resolved terms are in [`docs/glossary.md`](../../../docs/glossary.md); contradictions with code surfaced or filed as follow-up.

## Reference

- Format: [GLOSSARY-ENTRY.md](./GLOSSARY-ENTRY.md)
- Batch scan: [GLOSSARY-SCAN.md](./GLOSSARY-SCAN.md)
- Docs lifecycle: [`docs-governance`](../docs-governance/SKILL.md)
- Grilling + inline updates: [`grill-with-docs/ARTIFACTS.md`](../grill-with-docs/ARTIFACTS.md)
