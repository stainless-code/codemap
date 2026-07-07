---
name: docs-governance
description: Repo-wide docs framework — what `docs/`, `docs/plans/`, `docs/research/`, `.agents/`, or any other doc-bearing surface in this repo looks like, what lifecycle each doc follows, and how to keep cross-references intact when slimming or moving content. Use when authoring or editing any `docs/**`, `docs/plans/**`, `docs/research/**`, `.agents/rules/**`, `.agents/skills/**`, or any new doc-bearing folder. Defines the lifecycle types (Reference / Roadmap / Plan / Audit / Research), the existence test every doc must pass, the closing-state lifecycles (delete + lift; never "Slim & keep in plans/"), the substrate variants (single `audit.md` vs `audits/<topic>.md`; conditional `glossary.md`), the surface tiers (repo-wide / per-tooling-area), and the cross-reference preservation discipline (grep before slim; preserve rule numbers cited from source). The Tier-2 priming layer at `.agents/rules/docs-governance.md` cites this skill and extends with codemap-specific bits only.
---

# Docs governance

Repo-wide docs framework for codemap. Every doc in this repo lives in one of **two surface tiers** (codemap is small enough that the per-feature and per-shared-component tiers used in larger codebases don't apply here — yet). **Full blueprint:** [LIFECYCLE.md](./LIFECYCLE.md).

The repo-root `docs/README.md` is the single canonical surface for the cited Rules — every other doc points at it; never restate the Rules. Consumer-surface policy: [`.agents/rules/consumer-surfaces.md`](../../rules/consumer-surfaces.md) (Rule 10 sub-bullet).

## Quick rules

1. **Five lifecycle types** — Reference (`architecture.md`, `glossary.md`, `agents.md`, …), Roadmap (`roadmap.md`), Plan (`plans/<feature-name>.md`), Audit (`audit.md` or `audits/<topic>.md`), Research (`research/<tool-name>.md` or `research/<topic>-YYYY-MM.md`). New content folds into one of these; no new top-level types.
2. **Existence test** — a doc earns its place if source cites it, it carries durable policy unavailable elsewhere, it tracks open work, or inbound cites require a slim stub. Otherwise fold + delete.
3. **Plans are deleted + lifted when work ships** — durable bits move to `architecture.md` / `glossary.md` / `roadmap.md` / a rule or skill; the plan file dies. No "slim & keep in plans/" state.
4. **`.gitkeep`** in each potentially-empty lifecycle folder (`plans/`, `research/`, and `audits/` when it exists) so it stays discoverable when empty.
5. **Anti-bloat** — don't add a rule until there's content that needs it. Same for ownership-table rows in `docs/README.md`.
6. **Repo-level vs in-source** — codemap-wide tool evaluations + adoption (oxlint, future plugins) live in `.agents/rules/` + `.agents/skills/`, not as permanent `docs/research/` files. Per-tool tracker notes are an anti-pattern — positioning lives in [`docs/why-codemap.md`](../../../docs/why-codemap.md).
7. **Cross-reference preservation** — grep before slim; preserve cited rule numbers and section anchors. See [LIFECYCLE.md § 7](./LIFECYCLE.md#7-cross-reference-preservation-discipline).
8. **Provenance** — `docs/README.md` Rules **1–10** are cited from across `docs/` and `.agents/`. Don't renumber without a coordinated re-grep + edit pass.

## Reference

- [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md) — the doc janitor; walks doc surfaces and produces a per-file action plan.
- [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) — writes audit docs per LIFECYCLE closing prescriptions; closure step calls `docs-lifecycle-sweep` on the surrounding `audits/` folder.
- [`docs-governance` rule](../../rules/docs-governance.md) — Tier-2 priming on doc edits.
- [`agents-first-convention`](../../rules/agents-first-convention.md) — file-layout discipline (`.agents/` source of truth, `.cursor/` symlinks).
- [`agents-tier-system`](../../rules/agents-tier-system.md) — rules vs skills tier system.
- [`docs/README.md`](../../../docs/README.md) — canonical Rules + ownership table this skill describes the framework around.
