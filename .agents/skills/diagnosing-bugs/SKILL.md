---
name: diagnosing-bugs
description: Disciplined diagnosis loop for hard bugs and performance regressions. Reproduce → minimise → hypothesise → instrument → fix → regression-test. Use when user says "diagnose this" / "debug this", reports a bug, says something is broken/throwing/failing, or describes a performance regression.
---

# Diagnosing bugs

A discipline for hard bugs. Skip phases only when explicitly justified.

When exploring the codebase, query [`codemap`](../codemap/SKILL.md) (the structural SQLite index) before reaching for `Grep` or `Read` per the [`codemap` rule](../../rules/codemap.md) — symbol-shaped questions ("where is X defined?", "what calls X?") have direct answers in the `symbols` / `calls` tables. Read the relevant section of [`docs/architecture.md`](../../../docs/architecture.md) to ground the mental model of layering, and check [`docs/glossary.md`](../../../docs/glossary.md) for canonical domain terms (file types, recipe ids, schema columns).

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause — bisection, hypothesis-testing, and instrumentation all just consume that signal. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one — try them in roughly this order

1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e. Codemap convention: `src/**/<name>.test.ts` for unit + integration; `fixtures/golden/` for query-shape regressions; `bun test <file>` runs them.
2. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot. Examples: `bun src/index.ts query --json …` against `fixtures/minimal/`, golden runner under `scripts/query-golden.ts`.
3. **Replay a captured trace.** Save a real `.codemap/index.db` / config / fixture file to disk; replay it through the code path in isolation.
4. **Throwaway harness.** Spin up a minimal subset (one parser, one DB connection) that exercises the bug code path with a single function call.
5. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
6. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
7. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs. The B.6 baseline machinery (`codemap query --save-baseline` / `--baseline`) is built for exactly this — use it.
8. **HITL bash script.** Last resort. If a human must click or copy a value out of the IDE, drive _them_ with [`scripts/hitl-loop.template.sh`](scripts/hitl-loop.template.sh) so the loop is still structured. Captured output feeds back to you.

Build the right feedback loop, and the bug is 90% fixed.

### Iterate on the loop itself

Treat the loop as a product. Once you have _a_ loop, ask:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop. A 2-second deterministic loop is a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a captured artifact (HAR file, log dump, core dump, screen recording with timestamps, broken `.codemap/index.db`), or (c) permission to add temporary instrumentation. Do **not** proceed to hypothesise without a loop.

### Completion criterion — a tight loop that goes red

Phase 1 is done when the loop is **tight** and **red-capable**: you can name **one command** — a test invocation (`bun test <file>`), `bun src/index.ts query --json …`, a throwaway harness, or [`scripts/hitl-loop.template.sh`](scripts/hitl-loop.template.sh) for the human-in-the-loop case — that you have **already run at least once** (paste the invocation and its output), and that is:

- [ ] **Red-capable** — it drives the actual bug code path and asserts the **user's exact symptom**, so it can go red on this bug and green once fixed. Not "runs without erroring" — it must be able to _catch this specific bug_.
- [ ] **Deterministic** — same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — you can run it unattended; a human in the loop only via `scripts/hitl-loop.template.sh`.

If you catch yourself reading code to build a theory before this command exists, **stop — jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no Phase 2.

## Phase 2 — Reproduce

Run the loop. Watch the bug appear.

Confirm:

- [ ] The loop produces the failure mode the **user** described — not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

### Minimise

Once it's red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut — keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space in Phase 3 (fewer moving parts left to suspect) and becomes the clean regression test in Phase 5.

**Done when** every remaining element is load-bearing — removing any one of them makes the loop go green.

Do not proceed until you have reproduced **and** minimised.

## Phase 3 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If `<X>` is the cause, then `<Y>` will make the bug disappear / `<Z>` will make it worse."

If you cannot state the prediction, the hypothesis is a vibe — discard or sharpen it.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just changed #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it — proceed with your ranking if the user is AFK.

**Done when:** 3–5 ranked, falsifiable hypotheses stated (each with a prediction); user has seen the list before any fix attempt.

## Phase 4 — Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan, `--performance` flag for index runs), then bisect. Measure first, fix second.

**Done when:** one hypothesis confirmed or all falsified with evidence — one variable changed per probe, each probe mapped to a Phase 3 prediction.

## Phase 5 — Fix + regression test

Write the regression test **before the fix** — but only if there is a **correct seam** for it (per the [`improve-codebase-architecture`](../improve-codebase-architecture/SKILL.md) vocabulary).

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next phase.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

**Done when:** loop is green against the original scenario; regression test added at a correct seam, or the seam-gap is documented as an architectural finding.

## Phase 6 — Cleanup + post-mortem

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-…]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)
- [ ] The hypothesis that turned out correct is stated in the commit / PR message — so the next debugger learns
- [ ] If the post-mortem yields a permanent insight, **lift** it into `.agents/rules/` or the relevant skill; append to [`.agents/lessons.md`](../../lessons.md) only when it is not yet encoded elsewhere

**Then ask: what would have prevented this bug?** If the answer involves architectural change (no good test seam, tangled callers, hidden coupling) hand off to [`improve-codebase-architecture`](../improve-codebase-architecture/SKILL.md) with the specifics. Make the recommendation **after** the fix is in, not before — you have more information now than when you started.

**Done when:** no `[DEBUG-…]` sediment (`grep` clean); throwaway harnesses deleted; commit / PR message states the winning root-cause hypothesis; any durable insight lifted into `.agents/rules/` or a skill (else `.agents/lessons.md`).
