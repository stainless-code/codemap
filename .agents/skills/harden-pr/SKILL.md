---
name: harden-pr
description: >-
  Bring a branch to pristine, maximum production readiness without changing PR intent —
  spawn parallel Task subagents (never inline review), fix in-bounds findings, loop autonomously until
  clean or pass cap, then report once. Use after a tracer-bullet commit (lite), before PR
  is done (full), on "harden", "harden-pr", "pristine", "review until clean",
  "production-ready pass", or "harden-pr reconcile". Invoking this skill authorizes one harden commit at cycle end.
  NEVER stop mid-loop to ask about commits, babysit, or the next pass. NEVER redesign the
  feature or change observable runtime behavior.
---

# Harden PR

**Goal:** leave the PR / feature in **pristine, maximum production state** — every changed path shippable, verified, documented, and hygienic. Polish and harden what the PR already does; **never** change its intent or runtime behavior.

Local loop: parallel reviewer subagents → merge findings → fix in-bounds → re-verify → repeat until clean or cap → **one final report**.

**Invoking this skill (`/harden-pr`, `harden-pr lite`, `harden-pr full`, `harden-pr quick`, `harden-pr reconcile`) is a run-to-completion command.** The agent executes the full loop before ending the turn.

Sister skills: [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) (extended structural reviewer). **Workflow** (modes, roster, loop, git): [WORKFLOW.md](./WORKFLOW.md). **Ledger:** [LEDGER.md](./LEDGER.md). Mention **`babysit`** only in the final report (full mode) — never mid-loop.
