---
name: harden-pr
description: >-
  Bring a branch to pristine, maximum production readiness without changing PR intent —
  spawn parallel Task subagents (never inline review), fix in-bounds findings, loop autonomously until
  clean or pass cap, then report once. Use after a tracer-bullet commit (lite), before PR
  is done (full), or on "harden", "harden-pr", "pristine", "review until clean",
  "production-ready pass". Invoking this skill authorizes one harden commit at cycle end.
  NEVER stop mid-loop to ask about commits, babysit, or the next pass. NEVER redesign the
  feature or change observable runtime behavior.
---

# Harden PR

**Goal:** leave the PR / feature in **pristine, maximum production state** — every changed path shippable, verified, documented, and hygienic. Polish and harden what the PR already does; **never** change its intent or runtime behavior.

Local loop: parallel reviewer subagents → merge findings → fix in-bounds → re-verify → repeat until clean or cap → **one final report**.

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

| Phase           | Behavior                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **During loop** | Autonomous. `Task`-batch reviewers in parallel (§ Spawning subagents), merge JSON findings, fix in-bounds, re-run checks, advance pass counter. |
| **After loop**  | Single concise report: mode, passes run, production-bar status (met / gaps), fixes made, checks status, deferred nits (if any).                 |
| **Commit**      | If there are uncommitted fixes: one `harden: …` commit **without asking** — skill invocation authorizes it. If no fixes: skip commit.           |
| **Babysit**     | Full mode only. One line at end of report: "For GitHub/CI, run `/babysit`." Do not ask.                                                         |

## Modes

| Mode     | When                                                                                                                                         | Scope                   | Max passes |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------- |
| **Lite** | After each tracer-bullet slice commit ([`tracer-bullets`](../../rules/tracer-bullets.md) cadence)                                            | Files in the slice diff | 2          |
| **Full** | User intent ("full harden", "PR done", "production-ready pass") **or** offer when an in-flight `docs/plans/<topic>.md` checklist is complete | `origin/main...HEAD`    | 3          |

Default to **lite** when invoked immediately after a slice commit. Default to **full** when the user signals branch completion.

## Production bar (what "pristine" means)

Reviewers optimize for this bar on in-scope files. **Full** mode applies it to the entire `origin/main...HEAD` diff; **lite** to the slice diff.

| Area            | Pristine =                                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Correctness** | No known bugs or unhandled edge cases in changed paths; behavior matches intent anchor                                                                                                                            |
| **Tests**       | Changed behavior covered; affected tests pass                                                                                                                                                                     |
| **Checks**      | Format, lint, typecheck clean on touched files ([`verify-after-each-step`](../../rules/verify-after-each-step.md))                                                                                                |
| **Docs**        | User-visible changes reflected in docs, changesets, help text — no drift; **shipped `docs/plans/<topic>.md` deleted + lifted** in the same PR ([`docs-governance`](../docs-governance/SKILL.md) § Closing a plan) |
| **Surfaces**    | No maintainer leaks into consumer surfaces ([`consumer-surfaces`](../../rules/consumer-surfaces.md))                                                                                                              |
| **Structure**   | No boundary violations or barrel bypasses in the diff                                                                                                                                                             |
| **Hygiene**     | No dead code, TODO slop, or sloppy naming in touched files; errors actionable                                                                                                                                     |
| **Ship shape**  | A reviewer could merge without "fix before ship" notes (except deferred out-of-scope nits)                                                                                                                        |

If a finding moves the bar toward pristine and stays in-bounds → **fix it**, including nits in touched files.

## Intent anchor (every reviewer prompt includes this)

Resolve in order; stop at the first hit:

1. **Plan doc** — in-flight `docs/plans/<topic>.md`: goal + non-goals
2. **Commit range** — `git log --oneline origin/main...HEAD` + `git diff --name-status origin/main...HEAD`
3. **User anchor** — ask once: "What must not change?" (1–2 sentences). **Only step that may interrupt the loop.**

Reviewers treat the anchor as contract. Findings that would violate it → **report, do not apply**.

## In-bounds vs out-of-bounds

**Fix:** bugs, missing tests, docs/changeset drift, lint/type/format, error-handling gaps, edge cases, **behavior-preserving refactors in touched files**, in-scope nits (naming, comment hygiene, cheap lint fixes).

**Report only:** redesign, semantic API changes, nits outside the diff, refactors unrelated to a flagged issue.

**Do not defer complements:** agent-surface parity (rule/skill/MCP), glossary/architecture/golden-queries contracts, script/golden tests for acceptance criteria, and cross-links named in the plan ship in the **same PR** — not "optional v2" or post-merge unless the plan **Out of scope** section explicitly excludes them.

## Spawning subagents (non-negotiable)

The parent agent **MUST NOT** perform reviewer duties inline. Every pass **starts** with a parallel `Task` batch; grep/read/diff by the parent is setup only, **not** a substitute for reviewers.

| Rule            | Requirement                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Tool**        | Cursor **`Task`** tool only (`subagent_type`: `generalPurpose` for most reviewers; `explore` for Structure lite)     |
| **Batching**    | One parent message → **all** applicable reviewers for that pass **in parallel** (single turn, multiple `Task` calls) |
| **Readonly**    | `readonly: true` on every reviewer `Task` — reviewers report; parent fixes                                           |
| **Pass credit** | A pass counts only after parent merges subagent JSON and acts on actionable findings                                 |

**Anti-pattern (invalid harden):** parent reads the diff, runs tests, fixes nits, and reports — without spawning the roster below.

### Finding schema (every reviewer returns this)

Each reviewer returns **only** a JSON array (no prose wrapper). Parent parses arrays from all reviewers, then merges.

```json
{
  "finding": "One-sentence claim about a gap vs production bar",
  "severity": "blocker | major | minor | nit | info",
  "file": "repo-relative/path or \"multiple\"",
  "fixable_in_bounds": true
}
```

**Severity → action**

| Severity                   | Parent action                                                       |
| -------------------------- | ------------------------------------------------------------------- |
| `blocker` / `major`        | Fix in pass 1; must fix or defer with plan Out of scope before done |
| `minor` / `nit`            | Fix when in touched files; pass 2+ if pass 1 was crowded            |
| `info`                     | Log only unless zero-cost fix in diff                               |
| `fixable_in_bounds: false` | Final report deferred list — do not apply                           |

**Merge + dedupe (parent, after each batch)**

1. Concatenate all reviewer arrays.
2. Drop `info` unless it blocks ship shape.
3. Dedupe: same `file` + same root cause → keep highest severity, merge `finding` text.
4. Sort actionable: `blocker` → `major` → `minor` → `nit`.
5. If merged list is empty → pass succeeds; skip fix phase.

**Example merged queue (pass 1)**

```json
[
  {
    "finding": "CLI --help documents summary counts but not per-row attribution on --base JSON rows.",
    "severity": "major",
    "file": "src/cli/cmd-audit.ts",
    "fixable_in_bounds": true
  },
  {
    "finding": "Skill shard leaks requiredColumns when describing attribution.",
    "severity": "major",
    "file": "templates/agent-content/skill/10-recipes-context.md",
    "fixable_in_bounds": true
  },
  {
    "finding": "No e2e test for attribution: inherited on deprecated delta.",
    "severity": "nit",
    "file": "src/application/audit-worktree.test.ts",
    "fixable_in_bounds": true
  }
]
```

### Reviewer prompt template (copy per `Task`)

Fill `{ROLE}`, `{REPO}`, `{INTENT_ANCHOR}`, `{SCOPE}`, `{EXTRA}`; set `subagent_type` and `readonly: true`.

```text
You are the **{ROLE}** reviewer for `/harden-pr` on `{REPO}`.

**Intent anchor (contract — do not suggest changes that violate):**
{INTENT_ANCHOR}

**Scope:** {SCOPE}
(lite: slice diff files; full: `git diff --name-status origin/main...HEAD`)

**Production bar:** See harden-pr skill § Production bar — optimize for {ROLE} rows.

**Task:** {EXTRA}

**Return ONLY** a JSON array of findings:
[{ "finding": "...", "severity": "blocker|major|minor|nit|info", "file": "...", "fixable_in_bounds": true|false }]
If clean: []

Readonly — do not edit files.
```

**`{EXTRA}` by role**

| Role               | `{EXTRA}`                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Correctness        | Read changed source + tests; run affected `bun test <files>`; bugs, edge cases, missing coverage                   |
| Ship-readiness     | Grep inbound refs to deleted plan files; verify plan retired + lifted; changeset consumer-clean; cross-ref anchors |
| Structure (lite)   | Read `docs/architecture.md` § Layering; check diff imports for boundary violations; optional codemap queries       |
| Consumer surface   | Read `consumer-surfaces` rule; parity across CLI help, MCP description, agent-content, README, changeset           |
| Structure (full)   | Run `audit-pr-architecture` skill read-only; report only fixable-in-bounds items                                   |
| Schema / migration | `SCHEMA_VERSION`, migration paths, column contract drift                                                           |
| Security           | auth, secrets, env, user-input paths in diff                                                                       |
| Performance        | hot paths, benchmarks, worker pools in diff                                                                        |

## Reviewer roster

Spawn applicable reviewers **in parallel** via **`Task`** in **one batch per pass**. Each subagent returns the finding schema above.

### Core (always — every pass)

1. **Correctness** — gaps vs production bar; bugs, edge cases, missing tests in changed paths
2. **Ship-readiness** — gaps vs production bar; docs, changesets, consumer-surface leaks, error messages; **grep inbound refs → delete shipped plan file → lift to `golden-queries.md` / `architecture.md` / `roadmap.md`**; run [`verify-after-each-step`](../../rules/verify-after-each-step.md) checks on touched files
3. **Structure (lite)** — gaps vs production bar; boundary smells on the diff (imports across declared layers, barrel bypasses); query codemap per [`codemap`](../codemap/SKILL.md)

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
  Task-batch all applicable reviewers (parallel, readonly)
  parent: merge + dedupe JSON findings (§ Finding schema)
  if none actionable → goto done
  fix in-bounds (pass 1: all; passes 2+: blockers first, then in-scope nits)
  run project checks on touched files
  if clean and no new findings → goto done
  if pass >= max_passes → goto capped
  pass += 1
  goto loop
capped:
  emit deferred-nits list (each nit must cite plan Out of scope or cross-PR blocker — not "optional")
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
