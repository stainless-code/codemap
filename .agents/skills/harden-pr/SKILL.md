---
name: harden-pr
description: >-
  Production-harden a branch without changing PR intent — spawn parallel reviewer
  subagents, fix in-bounds findings, loop autonomously until clean or pass cap, then
  report once. Use after a tracer-bullet commit (lite), before PR is done (full), or on
  "harden", "harden-pr", "review until clean", "production-ready pass". Invoking this
  skill authorizes one harden commit at cycle end. NEVER stop mid-loop to ask about
  commits, babysit, or the next pass. NEVER redesign the feature or change observable
  runtime behavior.
---

# Harden PR

Local production-hardening loop: parallel reviewer subagents → merge findings → fix in-bounds → re-verify → repeat until clean or cap → **one final report**. Refines bugs, tests, docs, and hygiene — **not** the feature's goal or runtime behavior.

**Invoking this skill (`/harden-pr`, `harden-pr lite`, `harden-pr full`) is a run-to-completion command.** The agent executes the full loop before ending the turn.

Sister skills: [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) (extended structural reviewer). Mention **`babysit`** only in the final report (full mode) — never mid-loop.

## Run-to-completion (read first)

**NEVER** stop between passes to ask:

- whether to commit
- whether to run babysit
- whether to continue to the next pass
- whether to spawn another reviewer

**ONLY** allowed mid-loop question: intent anchor step 3 when plan doc and commit range both fail to state what must not change.

Otherwise: resolve anchor → run all passes → fix → verify → next pass → finish → report.

| Phase           | Behavior                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **During loop** | Autonomous. Spawn reviewers in parallel, merge findings, fix in-bounds, re-run checks, advance pass counter.                          |
| **After loop**  | Single concise report: mode, passes run, fixes made, checks status, deferred nits (if any).                                           |
| **Commit**      | If there are uncommitted fixes: one `harden: …` commit **without asking** — skill invocation authorizes it. If no fixes: skip commit. |
| **Babysit**     | Full mode only. One line at end of report: "For GitHub/CI, run `/babysit`." Do not ask.                                               |

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
3. **User anchor** — ask once: "What must not change?" (1–2 sentences). **Only step that may interrupt the loop.**

Reviewers treat the anchor as contract. Findings that would violate it → **report, do not apply**.

## In-bounds vs out-of-bounds

**Fix:** bugs, missing tests, docs/changeset drift, lint/type/format, error-handling gaps, edge cases, **behavior-preserving refactors in touched files**, in-scope nits (naming, comment hygiene, cheap lint fixes).

**Report only:** redesign, new capabilities, semantic API changes, nits outside the diff, refactors unrelated to a flagged issue.

## Reviewer roster

Spawn applicable reviewers **in parallel** via subagents in **one batch per pass**. Each returns `{ finding, severity, file, fixable_in_bounds }`.

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

Execute **without pausing for user input** until exit condition:

```
resolve intent anchor
pass = 1
loop:
  spawn reviewers (parallel, one batch)
  merge + dedupe findings
  if none actionable → goto done
  fix in-bounds (pass 1: all; passes 2+: blockers first, then in-scope nits)
  run project checks on touched files
  if clean and no new findings → goto done
  if pass >= max_passes → goto capped
  pass += 1
  goto loop
capped:
  emit deferred-nits list
done:
  if uncommitted fixes → git commit -m "harden: …"
  emit final report (include babysit one-liner if full mode)
```

**Pass cap behavior:** after cap, stop auto-fixing; list deferred nits. Do not block the next tracer slice.

## Git

Skill invocation **is** the commit authorization. After the loop: if fixes exist, create one `harden: …` commit immediately — do not ask first. If the working tree is clean, skip.

## Quick invoke

| Intent      | Say                                                    |
| ----------- | ------------------------------------------------------ |
| Post-slice  | `/harden-pr lite` or `/harden-pr` after a slice commit |
| Branch done | `/harden-pr full` or "production-ready pass"           |

Replaces the old copy-paste: _"spawn subagents → fix → loop until clean"_ — this skill **is** that loop.
