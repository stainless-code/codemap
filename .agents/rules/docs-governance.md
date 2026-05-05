---
description: Repo-wide docs framework primer. Use when authoring or editing any docs/, plans/, research/, or other doc-bearing surface in the repo. Defines surface tiers (repo-wide / per-tooling-area), the 5 lifecycle types, the existence test, anchor-preservation discipline, and the delete-and-lift plan lifecycle. Skill at `.agents/skills/docs-governance/SKILL.md` carries the full reference.
globs: "docs/**, .agents/**"
alwaysApply: false
---

# Docs governance

Before authoring or editing any doc in this repo, **read the [`docs-governance` skill](../skills/docs-governance/SKILL.md)** for the full reference. This rule is the priming layer.

The canonical Rules (1–9) live in [`docs/README.md`](../../docs/README.md) — cite them by number; never restate them.

## Surface tiers (which subset of governance applies)

| Tier                            | Substrate                                               | Examples                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B** — repo-wide cross-cutting | `docs/` at repo root                                    | `docs/architecture.md`, `docs/glossary.md`, `docs/roadmap.md`, `docs/agents.md`, `docs/plans/`, `docs/research/`, future `docs/audits/`            |
| **0** — per-tooling-area        | `.agents/`, `.cursor/`, `scripts/`, `templates/agents/` | Governed by [`agents-first-convention`](./agents-first-convention.md) + [`agents-tier-system`](./agents-tier-system.md); no per-area README needed |

(Tier C — per-feature governance — and Tier A — per-shared-component — don't apply yet; see [`docs-governance` § Doc-bearing surface tiers](../skills/docs-governance/SKILL.md#doc-bearing-surface-tiers) for when they would.)

## Five lifecycle types (universal)

| Type          | Folder                                                | Closing                                                             |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------- |
| **Reference** | root (`architecture.md`, `glossary.md`, etc.)         | Lives forever; kept current                                         |
| **Roadmap**   | root (`roadmap.md`, single file)                      | Lives forever                                                       |
| **Plan**      | `plans/<name>.md`                                     | **Delete + lift** when work ships (no "Slim & keep in plans/")      |
| **Audit**     | `audit.md` (single) OR `audits/<topic>.md` (multi)    | Substrate variants — see skill                                      |
| **Research**  | `research/<tool>.md` OR `research/<topic>-YYYY-MM.md` | Adopted (lift + delete) / Rejected (keep with status header) / Open |

## Top three disciplines

1. **Anchor preservation** — slim READMEs keep cited rule numbers and section anchors. Grep before any slim: `rg "Rule [0-9]+" docs/` and `rg "<doc-path>(#[a-z-]+)?"`.
2. **Anti-bloat meta-rule** — don't add a rule until there's content that needs it. Same for ownership-table rows.
3. **Repo-level vs in-source** — repo-wide tool evaluations + adoption (oxlint, future plugins) live in `.agents/`, not as permanent `docs/research/` files. A `docs/research/` file may motivate the adoption, but the rule + skill earn the permanent home. Per-tool tracker notes (peer-tool comparisons, adoption-candidate logs) are an anti-pattern — peer-tool framing goes off-mission fast; positioning lives in [`docs/why-codemap.md`](../../docs/why-codemap.md) and [`research/non-goals-reassessment-2026-05.md`](../../docs/research/non-goals-reassessment-2026-05.md), not in tracker files.

## Existence test (apply on every doc-touching PR)

A file earns its place if it meets at least one of:

1. Source code cites it (JSDoc, error message, comment grep-anchor)
2. It documents durable policy unavailable elsewhere
3. It tracks open work (audit findings, plan, roadmap items, evaluation)
4. It carries unique historical context that `git log` + reference docs can't reconstruct

If none → fold + delete.

## Reference

- Full reference: [`.agents/skills/docs-governance/SKILL.md`](../skills/docs-governance/SKILL.md)
- Doc janitor (operational sweep — apply the spec mechanically, classify Tier A / B / C, delete dead weight): [`.agents/skills/docs-lifecycle-sweep/SKILL.md`](../skills/docs-lifecycle-sweep/SKILL.md). Fire on intent ("clean up stale docs", "compact audits") or proactively after closing a Plan / Audit / Research file.
- Audit framework: [`.agents/skills/audit-pr-architecture/SKILL.md`](../skills/audit-pr-architecture/SKILL.md). Fire on intent ("audit this PR's architecture", "structural review of #N") or proactively when a PR moves ≥5 files between top-level `src/` modules.
- Canonical Rules: [`docs/README.md`](../../docs/README.md) — Rules 1–9 cited from across `docs/` and `.agents/`. Don't renumber without a coordinated re-grep + edit pass.
- File-layout: [`agents-first-convention`](./agents-first-convention.md)
- Rules vs skills tier system: [`agents-tier-system`](./agents-tier-system.md)
