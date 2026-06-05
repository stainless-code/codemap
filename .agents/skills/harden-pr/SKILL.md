---
name: harden-pr
description: >-
  Production-harden a branch without changing PR intent — spawn parallel reviewer
  subagents, fix in-bounds findings, loop until clean or cap. Use after a tracer-bullet
  commit (lite), before PR is done (full), or on "harden", "review until clean",
  "production-ready pass", "make this merge-ready locally". Sister to babysit (external
  GitHub/CI) — hand off there only after local hardening. NEVER redesign the feature or
  change observable runtime behavior.
---

# Harden PR

Local production-hardening loop: parallel reviewer subagents → merge findings → fix in-bounds → re-verify → repeat. Refines bugs, tests, docs, and hygiene — **not** the feature's goal or runtime behavior.

Sister skills: [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) (extended structural reviewer). After local hardening, hand off to the Cursor **`babysit`** skill (personal — GitHub comments + CI).

## Modes

| Mode     | When                                                                                                                                         | Scope                   | Max passes |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| **Lite** | After each tracer-bullet slice commit ([`tracer-bullets`](../../rules/tracer-bullets.md) cadence)                                            | Files in the slice diff | 2          |
| **Full** | User intent ("full harden", "PR done", "production-ready pass") **or** offer when an in-flight `docs/plans/<topic>.md` checklist is complete | `origin/main...HEAD`    | 3          |

Default to **lite** when invoked immediately after a slice commit. Default to **full** when the user signals branch completion.

## Intent anchor (every reviewer prompt includes this)

Resolve in order; stop at the first hit:

1. **Plan doc** — in-flight `docs/plans/<topic>.md`: goal + non-goals
2. **Commit range** — `git log --oneline origin/main...HEAD` + `git diff --name-status origin/main...HEAD`
3. **User anchor** — ask once: "What must not change?" (1–2 sentences)

Reviewers treat the anchor as contract. Findings that would violate it → **report, do not apply**.

## In-bounds vs out-of-bounds

**Fix:** bugs, missing tests, docs/changeset drift, lint/type/format, error-handling gaps, edge cases, **behavior-preserving refactors in touched files**, in-scope nits (naming, comment hygiene, cheap lint fixes).

**Report only:** redesign, new capabilities, semantic API changes, nits outside the diff, refactors unrelated to a flagged issue.

## Reviewer roster

Spawn applicable reviewers **in parallel** via subagents. Each returns `{ finding, severity, file, fixable_in_bounds }`.

### Core (always)

1. **Correctness** — bugs, edge cases, missing tests in changed paths
2. **Ship-readiness** — docs, changesets, consumer-surface leaks ([`consumer-surfaces`](../../rules/consumer-surfaces.md)), error messages; run [`verify-after-each-step`](../../rules/verify-after-each-step.md) checks on touched files
3. **Structure (lite)** — boundary smells on the diff only (imports across declared layers, barrel bypasses); query codemap per [`codemap`](../codemap/SKILL.md)

### Extended (adaptive — spawn when diff triggers match)

| Reviewer               | Trigger                                                                                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Structure (full)**   | ≥5 files moved between top-level `src/` modules, new `src/<X>/` folder, or user asked for structural review → run [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) read-only; apply only fixable in-bounds items, not audit-doc recommendations that change design |
| **Schema / migration** | `src/db.ts`, `SCHEMA_VERSION`, migration paths                                                                                                                                                                                                                                 |
| **Consumer surface**   | `templates/agent-content/**`, root `README.md`, CLI help/errors, `.changeset/*.md` bodies                                                                                                                                                                                      |
| **Security**           | auth, secrets, env handling, user-input paths                                                                                                                                                                                                                                  |
| **Performance**        | hot paths, benchmarks, worker pools                                                                                                                                                                                                                                            |

Re-derive layer globs from `docs/architecture.md` § Layering — don't hardcode module lists that drift.

## Loop

```
resolve intent anchor
spawn reviewers (parallel)
merge + dedupe findings
if none actionable → done
fix in-bounds (pass 1: all; passes 2+: blockers first, then in-scope nits)
run project checks on touched files
if clean and no new findings → done
if pass cap hit → emit deferred-nits list → done
else → next pass
```

**Pass cap behavior:** after cap, stop auto-fixing; list deferred nits. Do not block the next tracer slice.

## Git

When the user has asked for commits: one `harden: …` commit per hardening cycle (lite or full), after the loop finishes. Never commit without explicit user request.

## Handoff

When **full** harden completes clean (or capped with only deferred nits): offer the Cursor **`babysit`** skill for GitHub comments, CI, and merge conflicts — external merge-readiness is out of scope here.

## Quick invoke

Replace the copy-pasted loop prompt with:

> **Lite** (post-slice): `harden-pr lite`
>
> **Full** (branch done): `harden-pr full`

Or attach this skill and say "harden after this commit" / "production-ready pass".
