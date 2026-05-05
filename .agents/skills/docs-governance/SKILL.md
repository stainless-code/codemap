---
name: docs-governance
description: Repo-wide docs framework — what `docs/`, `docs/plans/`, `docs/research/`, `.agents/`, or any other doc-bearing surface in this repo looks like, what lifecycle each doc follows, and how to keep cross-references intact when slimming or moving content. Use when authoring or editing any `docs/**`, `docs/plans/**`, `docs/research/**`, `.agents/rules/**`, `.agents/skills/**`, or any new doc-bearing folder. Defines the lifecycle types (Reference / Roadmap / Plan / Audit / Research), the existence test every doc must pass, the closing-state lifecycles (delete + lift; never "Slim & keep in plans/"), the substrate variants (single `audit.md` vs `audits/<topic>.md`; conditional `glossary.md`), the surface tiers (repo-wide / per-tooling-area), and the cross-reference preservation discipline (grep before slim; preserve rule numbers cited from source). The Tier-2 priming layer at `.agents/rules/docs-governance.md` cites this skill and extends with codemap-specific bits only.
---

# Docs governance — repo-wide blueprint

Read [`.agents/rules/docs-governance.md`](../../rules/docs-governance.md) first for the priming rule and quick reference. This file is the canonical blueprint.

Every doc in this repo lives in one of **two surface tiers** (codemap is small enough that the per-feature and per-shared-component tiers used in larger codebases don't apply here — yet). Each tier inherits the same **shared spine** (lifecycle types, existence test, naming, anti-bloat discipline) and applies a **substrate subset** appropriate to its scope. The repo-root `docs/README.md` is the single canonical surface for the cited Rules — every other doc points at it; never restate the Rules.

---

## Doc-bearing surface tiers

| Tier                                 | Substrate                          | Examples today                                                                                                                                                                                              | Governance shape                                                                                                                                                                                                                                                       |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tier B** — repo-wide cross-cutting | `docs/` at repo root               | `docs/architecture.md`, `docs/glossary.md`, `docs/roadmap.md`, `docs/plans/`, `docs/research/`, `docs/agents.md`, `docs/benchmark.md`, `docs/golden-queries.md`, `docs/packaging.md`, `docs/why-codemap.md` | Single `docs/README.md` carrying the **canonical numbered Rules** + ownership table + lifecycle prescription; cross-cutting reference docs at the root; `plans/`, `research/`, and (when needed) `audits/` substrate folders                                           |
| **Tier 0** — per-tooling-area        | `.agents/`, `.cursor/`, `scripts/` | `.agents/rules/`, `.agents/skills/`, `.cursor/rules/` (symlinks), `.cursor/skills/` (symlinks), `templates/agents/` (bundled for `codemap agents init`)                                                     | Implicit governance via [`agents-first-convention`](../../rules/agents-first-convention.md) + [`agents-tier-system`](../../rules/agents-tier-system.md); no per-area `README.md` needed; the rules + skills are themselves the docs and earn their place per § 2 below |

The same shared spine applies to both. The differences are what subset each tier needs.

> **Why no Tier C / Tier A in codemap?** Tier C (per-feature governance) only kicks in when a codebase grows independently-evolving feature folders (`app/features/<f>/`). Tier A (per-shared-component) only kicks in when shared components accumulate enough rationale to need a `README.md` next to the source. Codemap has neither today — the source tree is `src/cli/`, `src/application/`, `src/adapters/`, `src/parsers/`, `src/db.ts`, etc., all governed by the central `docs/` surface. If codemap ever grows a `src/<feature>/` partition or a `src/components/<x>/` shared-component substrate worth documenting in-place, this skill grows the corresponding tier rows then — not before (per § 5 anti-bloat).

---

## Shared spine (applies to every tier)

### 1. Five lifecycle types

Every doc fits one of these. New content folds into an existing type or earns a new top-level home — it does not spawn a new type.

| Type          | Folder                                                                     | Lifecycle                                                                        |
| ------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Reference** | root of the surface (`architecture.md`, `glossary.md`, `agents.md`, etc.)  | Lives forever. Kept current per the per-tier rules below                         |
| **Roadmap**   | root (`roadmap.md`, single file per surface)                               | Lives forever. Items move in (new findings) and out (per "When something ships") |
| **Plan**      | `plans/<feature-name>.md`                                                  | Created when work commits. Closed per § Closing a plan below                     |
| **Audit**     | `audit.md` (single substrate) OR `audits/<topic>.md` (multi substrate)     | Created at audit time. Closed per § Closing an audit below                       |
| **Research**  | `research/<tool-name>.md` OR `research/<topic>-YYYY-MM.md` for dated scans | Created when an evaluation begins. Closed per § Closing research below           |

Backlogs, frameworks, decisions, and ephemeral notes do not get their own top-level file. They fold into one of the five:

- **Backlogs** of open items → a section in `roadmap.md`
- **Frameworks / playbooks** that emerged from an audit → stay in the audit while it's kept; lift into a reference doc (or `.agents/rules/` / `.agents/skills/` for project-wide policy) if the audit gets retired
- **Decisions of record** from a concluded research evaluation → lift into the relevant reference doc; the research file's job is the evaluation, not the decision

### 2. Existence test (apply on every doc-touching PR)

A file earns its place if it meets at least one of:

1. **Source code cites it** (JSDoc, error message, comment grep-anchor, cited rule number, file path reference)
2. **It documents durable policy or framework** unavailable elsewhere
3. **It tracks open work** (open audit findings, in-flight plan, roadmap items, ongoing evaluation)
4. **It carries unique historical context** that `git log` + the relevant reference doc cannot reconstruct

If none → fold any salvageable content into `roadmap.md` / `architecture.md` / the relevant reference doc, fix the cross-refs, delete the file.

### 3. Naming conventions

- **`plans/` files**: `<feature-name>.md` — the folder provides "plan" context; don't add a `-plan` suffix
- **`research/` files**: `<tool-name>.md` for ongoing tool evaluations; `<topic>-YYYY-MM.md` for dated competitive scans
- **`audits/` files**: `<YYYY-MM-DD>-<topic>.md` for dated targeted audits OR `<topic>.md` for ongoing topic audits
- **Top-level reference files**: descriptive domain name (e.g. `architecture.md`, `glossary.md`, `agents.md`)
- All files: kebab-case

### 4. `.gitkeep` discipline

Every potentially-empty docs subdirectory carries a `.gitkeep` so the directory is discoverable even when empty:

```text
docs/
├── plans/.gitkeep       # required even when plans/ is empty
└── research/.gitkeep    # required even when research/ is empty
```

Subdirectories without `.gitkeep` signal "this convention isn't expected here" — the absence is informative. (Codemap doesn't ship an `audits/` folder today; if the first audit lands, that's when `audits/.gitkeep` shows up alongside it.)

### 5. Anti-bloat meta-rule

**Don't add a rule until there's content that needs it.** Speculative governance rules accumulate noise without enforcement. Each rule must point at concrete content (a file, a pattern, a citation) it governs.

Same applies to ownership-table rows — a row exists when the file or folder it describes exists.

### 6. Repo-level vs in-source clarification

**Codemap-wide tool evaluations + adoption** (e.g. oxlint, future plugins) belong directly in `.agents/rules/` + `.agents/skills/` — not in `docs/research/`. The artifact that earns a permanent home isn't the evaluation; it's the rule + skill.

A `docs/research/` file may **motivate** adoption of a repo-level tool, but the _adoption itself_ is repo-level — the rule lands under `.agents/rules/`, not as a permanent doc under `docs/research/`. The research note then slims to "what shipped" (per [`docs/README.md` Rule 8](../../../docs/README.md)). **Per-tool tracker notes are an anti-pattern** — peer-tool framing goes off-mission fast; positioning lives in [`docs/why-codemap.md`](../../../docs/why-codemap.md) and [`research/non-goals-reassessment-2026-05.md`](../../../docs/research/non-goals-reassessment-2026-05.md), not in tracker files.

### 7. Cross-reference preservation discipline

Before slimming or moving any doc with rules or named sections cited from source code or other docs:

```bash
# Grep every reference to the doc + its anchors
rg "<path>(#[a-z-]+)?" .
rg "Rule [0-9]+" <relevant docs>
rg "@see.*<path>" src/ scripts/
```

Then:

- **Preserve cited rule numbers** — if `Rule 6` is referenced from source, keep `Rule 6` in `docs/README.md`. Renumbering breaks grep-anchors silently.
- **Preserve cited section anchors** — if `#closing-a-plan` is referenced, keep the `## Closing a plan` heading in the slim README so the anchor still resolves.
- **If renumbering is unavoidable**, update every citation in the same commit.
- **Re-grep after slim** to confirm no broken references.
- **Don't maintain enumerated cross-reference indexes inline.** A line like _"Cited from `audit.md`, `audits/<x>.md`, `testing.md`"_ is a hand-maintained index that drifts on every slim. The grep command IS the index — cite the command (`rg "Rule [0-9]+" <scope>`) and let it re-derive on demand. Same logic as inventory counts ([`docs/README.md` Rule 6](../../../docs/README.md)): hand-maintained snapshots of mechanical facts always rot.

This is the most important migration discipline. Anchor breakage is silent and degrades over time.

### 8. Provenance pattern (optional today)

If a future tier (per-feature, per-component) opens up, every per-surface README should cite this skill in its opening section:

```md
> **Governance:** This README follows the [docs-governance skill](../../../.agents/skills/docs-governance/SKILL.md). Below: <surface>-specific scope, ownership extensions, and deliberate omissions.
```

Slim per-surface README content = scope statement + ownership table for **surface-specific** files only + surface-specific rules (with same numbers as before if any are cited from source) + deliberate-omissions section + provenance line. Everything else (lifecycle types, existence test, closing states, naming, anti-bloat) stays in this skill.

Today, codemap has only the repo-root `docs/README.md` (Tier B). It doesn't strictly need a provenance line because it _is_ the canonical surface — but it should still link to this skill from its "Document Lifecycle" section for the deeper reference. (Today it does so implicitly via the rule it cites; promoting that to a direct skill link is fine.)

---

## Lifecycle prescriptions per type

### Closing an audit

Codemap doesn't ship an `audits/` folder today. When the first audit lands, choose substrate per:

| Substrate                          | When to use                                               | Closing                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Single-file `audit.md`**         | One rolling audit doc                                     | When all open items resolve: lift deferred items to `roadmap.md`; **slim** closed findings to durable policy + cited-from-source bits; keep "Last verified" header current                                                                                                                                                                                                                                      |
| **Multi-file `audits/<topic>.md`** | Multiple targeted audit passes worth keeping side-by-side | Per audit: **No source cites AND no unique policy** → digest deferred items into `roadmap.md` (or absorb into a reference doc), then **delete** the audit file (don't leave a tombstone). **Has source cites OR unique policy** → **slim** to the cited findings + the durable policy; add a `Status: Closed` header; file stays in `audits/`. Index closed audits from `roadmap.md § Closed audits (pointers)` |

**The re-derivable test (positive framing of "no source cites AND no unique policy").** Before keeping a closed audit, ask: _would a fresh audit run today re-derive every finding from current code (codemap query, static-analysis tooling, grep, schema)?_ If yes and nothing in source points back to this file by name, the audit's only remaining job is historical archaeology — `git log --follow` does that better than a stale snapshot. **Delete it.** Three things an audit can carry that the codebase cannot infer, and that earn a slim+keep:

1. **Decisions of record** with rejected alternatives ("we kept X at root because Y; the Z alternative was considered and rejected because…"). Code shows the result, not the rejection rationale.
2. **Source-back-references** — `NOTE(...)` markers, JSDocs, or test names that cite the audit by file. Deletion would orphan them.
3. **Reusable methodology / playbook** that doesn't already live in a skill (the SQL queries, the verification recipe). If it does live in a skill, lift any deltas and delete.

If none of the three apply: digest deferred items to `roadmap.md`, lift any orphan-able knowledge, then delete. No tombstones.

**Promote single → multi when the second targeted audit lands.** Don't preemptively split.

### Closing a plan

The _one_ lifecycle, no "Slim & keep in plans/" option:

- **Default — delete + lift.** When work ships, the plan's durable bits move to where they earn a permanent home; the plan file dies. Lift destinations:
  - **Caller-facing convention** → `architecture.md` (or a topic-split sibling under `architecture/<topic>.md` if `architecture.md` ever needs splitting)
  - **New domain term** → `glossary.md` entry
  - **Slim-but-coherent durable policy with source cites** → `audits/<topic>.md` with `Status: Closed`
  - **Project-wide policy** → `.agents/rules/` / `.agents/skills/`
  - **Decision-of-record from external evaluation** → already covered by § Closing research
- **In-flight or deferred** → stays in `plans/` with no status header (open is the default).
- **No "Slim & keep in plans/" state.** A shipped doc that's worth keeping for rejected-alternatives / sequencing-rationale / API-shape-negotiation is no longer a plan; it earned a permanent home elsewhere. Categories should be defined by what the doc is now, not by where it started.

### Closing research

A research file's job is the evaluation. When the evaluation concludes, follow the canonical [`docs/README.md` Rule 8](../../../docs/README.md) lifecycle:

- **Adopted** → lift the decision-of-record into the relevant reference doc (`architecture.md`, `glossary.md`, etc.) or — for repo-level tools — into `.agents/rules/` + `.agents/skills/`. **Slim the note to a "What shipped" appendix** linking to canonical homes (precedent: [`research/non-goals-reassessment-2026-05.md`](../../../docs/research/non-goals-reassessment-2026-05.md) — its § 8 errata + § Closed-out items pattern). **Exception:** § 6 anti-pattern files (per-tool trackers; peer-tool framing) get **deleted**, not slimmed — the framing was off-mission, not just stale, and a "What shipped" appendix would re-anchor the wrong mental model.
- **Rejected** → add a `Status: Rejected (date) — <one-line reason>` header at the top. Keep the file. The rejection rationale is exactly what saves the next agent from re-litigating it.
- **Open / Ongoing** → stays in `research/` with no status header (open is the default). Ongoing tool trackers (e.g. `research/<tool-name>.md`) are explicitly long-lived but **only when they aren't peer-tool trackers** — see § 6.

---

## Per-surface subset prescriptions

### Tier B — repo-wide cross-cutting (the canonical surface today)

Mandatory: `docs/README.md` — the canonical Rules + ownership table + lifecycle prescription.

When present, the repo-root `docs/README.md` documents:

- The cross-cutting reference docs at the root (e.g. `architecture.md`, `glossary.md`, `agents.md`)
- The `plans/`, `research/`, and (if/when) `audits/` substrate folders (folder-level convention; don't enumerate files)
- The numbered Rules — cited from source code and other docs; their numbers are stable per § 7
- A reference back to this skill for the deep dive
- No "feature-specific" rules — repo-wide concerns only

### Tier 0 — per-tooling-area

`.agents/`, `.cursor/`, `scripts/`, `templates/agents/` — no per-area `README.md` needed (with the exception of `templates/agents/README.md`, which exists because the bundled templates ship to npm consumers and the README explains the consumer-vs-maintainer distinction). Governance lives in the rules + skills themselves:

- File-layout discipline → [`agents-first-convention`](../../rules/agents-first-convention.md) (`.agents/` is source of truth; `.cursor/` is symlinks)
- Tier system for rules → [`agents-tier-system`](../../rules/agents-tier-system.md)

These rules are themselves docs; they're governed by their own existence test (do they earn their place per § 2?).

---

## Numbering convention for slim per-surface READMEs

If a future tier brings additional READMEs, they may keep a numbered Rules section as a quick-reference. Numbers are **per-surface stable** (not aligned across surfaces) — `docs/README.md`'s Rule 6 may differ from a future surface's Rule 6.

**Anchor preservation discipline (per § 7):**

- If a rule is cited from source code or other docs, the slim README keeps the same number. Substance shrinks to a one-liner: `**Rule 6 — No inventory counts.** See [skill § anti-bloat](path)`.
- Rule numbering may compact (delete a rule that's now in the skill exclusively) only if no citation references its number.
- Any renumbering happens in the same commit as the citation updates.

For `docs/README.md` today: Rules **1–9** are cited from across `docs/` and `.agents/`. Don't renumber without a coordinated re-grep + edit pass.

---

## Extension discipline

A per-surface README extends this skill rather than restating it. Concretely:

- **DO** add surface-specific ownership rows for files that don't fit the universal pattern.
- **DO** add surface-specific rules with concrete examples (e.g. codemap's "no inventory counts in narrative — counts of files / symbols / recipes drift on every PR").
- **DO** add a deliberate-omissions section (what the surface _deliberately doesn't carry_ and why).
- **DON'T** restate the 5 lifecycle types (skill carries them).
- **DON'T** restate the existence test (skill carries it).
- **DON'T** restate the closing-state lifecycles (skill carries them).
- **DON'T** restate naming conventions (skill carries them).

If you find yourself copying sections from this skill into a per-surface README, stop — link to the skill section instead.

---

## Reference

- [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md) — operationalises this spec on demand: walks any doc surface, applies the existence test + closing prescriptions, classifies each file Tier A (keep verbatim) / Tier B (slim + keep) / Tier C (delete + lift), surfaces evidence + cross-reference impact, executes on user approval. Use whenever you'd otherwise need to read this whole spec and apply it by hand to a folder of accumulated docs.
- [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) — writes audit docs per § Closing an audit substrate variants. Closure step calls `docs-lifecycle-sweep` on the surrounding `audits/` folder.
- [`docs-governance` rule](../../rules/docs-governance.md) — the Tier-2 priming layer; cites this skill on any doc-touching edit.
- [`agents-first-convention`](../../rules/agents-first-convention.md) — file-layout discipline (`.agents/` source of truth, `.cursor/` symlinks).
- [`agents-tier-system`](../../rules/agents-tier-system.md) — rules vs skills, when each tier applies.
- [`docs/README.md`](../../../docs/README.md) — the canonical Rules + ownership table this skill describes the framework around.
