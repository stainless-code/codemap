---
description: Always follow the docs governance in docs/README.md when touching files under docs/. Specifically: cite Rules by number, update File Ownership and Single Source of Truth tables when adding/removing docs, fold new content into existing files unless it passes the Existence Test.
alwaysApply: true
---

# Docs Governance

`docs/README.md` is the source of truth for how the docs folder is organized and edited. Read it first whenever you touch anything under `docs/`.

## Quick checklist

When you change a doc, these checks must pass before the PR ships:

- **Rule 1 — One source of truth.** No prose duplicated across files. Cross-reference by relative path instead.
- **Rule 2 — Shipped items leave the roadmap.** When a backlog item lands, move its description to its canonical home (architecture / why-codemap / README) and remove it from `roadmap.md`.
- **Rule 3 — Plans get their own file.** Don't embed plans in `roadmap.md`. Create `docs/plans/<feature-name>.md` and link from the roadmap entry.
- **Rule 4 — Tables stay current.** When you add or delete a doc, update the **File Ownership** and **Single Source of Truth** tables in `docs/README.md` in the same PR.
- **Rule 5 — Relative cross-references.** `[architecture.md § Section](./architecture.md#section)` — never absolute paths or repo URLs for in-tree docs.
- **Rule 6 — No inventory counts in narrative.** Don't hardcode counts of files / symbols / recipes. Use qualitative descriptors or a `codemap query` example. Decision values (cache TTLs, `SCHEMA_VERSION`) are fine.
- **Rule 7 — No line-number references.** Cite by function name, section heading, or `codemap query` lookup. Methodology tables in `benchmark.md` are exempt.
- **Rule 8 — Close research notes.** When a `research/` scan's adopt items ship, slim it to a "What shipped" appendix linking to canonical homes. Rejected items keep a `Status: Rejected (date) — <reason>` header.
- **Rule 9 — New term ⇒ glossary.** Every PR that introduces a new domain noun (table name, recipe id, parser name, schema column) updates `docs/glossary.md` in the same PR. Disambiguations (e.g. `FileRow` TS shape vs `files` SQLite table) take priority.

## Document Lifecycle (full text in `docs/README.md`)

Four doc types: **Reference** (lives forever), **Roadmap** (single file, items move in/out), **Plan** (created on commit, deleted on ship), **Research** (created for evaluations, closed per § Closing research).

Backlogs / frameworks / decisions don't get their own file — they fold into one of the four.

### Existence test (apply on every doc-touching PR)

A file earns its place if it meets at least one of:

1. Source code or another doc cites it (grep finds the path).
2. It documents durable policy or framework unavailable elsewhere.
3. It tracks open work.
4. It carries unique historical context that `git log` + `architecture.md` cannot reconstruct.

If none → fold any salvageable content into roadmap / architecture / glossary, fix cross-refs, **delete the file**.

### Top-level cap

Adding a new top-level doc requires:

1. The topic doesn't fit any existing root-level doc.
2. The new file passes the existence test on day one.
3. **File Ownership** table in `docs/README.md` updated in the same PR.

When in doubt, default to absorbing into the closest existing root-level file.

## Why this exists

- Avoids the slow rot that hits any docs folder where any contributor (human or agent) can drop a new top-level file at any time.
- Gives reviewers cite-able rule numbers ("violates Rule 4") instead of vague "this should go elsewhere" feedback.
- Keeps `git log` legible by making doc files have predictable lifecycles.

## Reference

- [`docs/README.md`](../../docs/README.md) — full text of all rules, the lifecycle, and the existence test.
- Adapted from PaySpace `analytics/docs/README.md` governance pattern.
