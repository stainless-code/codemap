---
name: audit-pr-architecture
description: Audit a PR's structural choices against architecture-priming, the repo's own architecture.md, and any nested boundary configs. Use when the user says "audit this PR's architecture", "check the boundaries", "is this PR clean structurally", "post-merge review of #N", "do a structural review", "what's the boundary impact of this PR", or asks to fact-check the lift / extract / share decisions on a refactor PR. Output is an audit doc at `docs/audits/<YYYY-MM-DD>-<topic>.md` (or — until the first audit lands — a `docs/audits/.gitkeep` + the new file). NEVER edit source while running this — produce a findings doc + a per-finding plan first.
---

# Audit a PR's architecture

Mid-flight or post-merge structural review of a PR against the repo's own architecture and boundary conventions. Sister skill to [`pr-comment-fact-check`](../pr-comment-fact-check/SKILL.md) when codemap adopts that one (reviewer-comment-driven).

This skill exists because:

- Lightweight STOP signals (new top-level src/ folder, new shared util with 3+ consumers, folder past ~15 files without `index.ts`, files moved across module boundaries) miss **content-driven** smells (twin wrappers, incomplete lifts, dead leftovers from a move) that show up only after the PR has been opened.
- The audit recipe (codemap reindex → boundary queries → fallow audit → cross-check rules → write findings) is reusable but lived nowhere before this skill — every audit was rebuilding it from scratch.

## When to fire

User intent (any of these phrases is enough):

- "audit this PR's architecture" / "structural review of #N"
- "check the boundaries on this branch"
- "is this PR clean / does this respect the boundaries"
- "post-merge architecture audit"
- "what did the lift miss"
- "fact-check the structural choices on this refactor"

Also fire **proactively** when:

- A PR moves ≥5 files between top-level `src/` modules (e.g. `src/cli/` → `src/application/`, `src/parsers/` → `src/adapters/`).
- A PR introduces a new `src/<X>/` subfolder.
- A PR closes a structural STOP signal (so the closure is recorded with evidence).

## The 6-step recipe

### 1. Reindex codemap and identify the diff scope

```bash
bun run codemap   # or: codemap (from outside the repo)
git diff --name-status origin/main...HEAD
```

Note: the affected source modules (`src/cli/`, `src/application/`, `src/adapters/`, `src/parsers/`, `src/db.ts`, etc.), the PR's intent commit (the lift / extract / share), and the surrounding subtrees.

### 2. Derive the boundary-leak SQL kit from the repo's own architecture

Don't ship a fixed kit — **derive the queries from `docs/architecture.md`** (the canonical source of layering and module boundaries) and any prior audits in `docs/audits/`. Codemap's own architecture defines its layering; any new audit reads that layering and writes queries to verify it.

For each one-directional edge the architecture declares, the query template is the same:

```bash
bunx codemap query --json "
SELECT DISTINCT from_path, to_path
FROM dependencies
WHERE from_path LIKE '<from-glob>'
  AND to_path LIKE '<to-glob>'
"
```

For each pair of sibling subtrees the architecture declares mutually-isolated, the template is symmetric:

```bash
bunx codemap query --json "
SELECT DISTINCT from_path, to_path
FROM dependencies
WHERE
  (from_path LIKE '<a-glob>' AND to_path LIKE '<b-glob>')
  OR (from_path LIKE '<b-glob>' AND to_path LIKE '<a-glob>')
"
```

For each per-folder public-surface (a folder whose internals must be reached only via its barrel / `index.ts`), the template is:

```bash
bunx codemap query --json "
SELECT DISTINCT i.source FROM imports i
WHERE i.file_path LIKE 'src/%'
  AND i.source LIKE '<surface>/<internal>/%'
  AND i.file_path NOT LIKE '<surface>/%'
"
```

Each query should return `[]`. Non-empty = **boundary regression**, primary finding for the audit doc.

**Pin the kit in the audit doc verbatim.** Once derived for codemap, paste the queries (with concrete globs, not placeholders) into the audit doc's § Boundary verification so the next reviewer can re-run them as a kit. Each subsequent audit can cite the prior audit's § Boundary verification instead of re-deriving.

#### Shape examples (don't depend on specific audit filenames)

Codemap's `docs/architecture.md` declares a layering: `src/cli/` (entry), `src/application/` (orchestration), `src/adapters/` (per-language extraction), `src/parsers/` (CSS / TS), `src/db.ts` (SQLite), `src/index.ts` (programmatic API). That shape maps to roughly **3–4 forbidden-edge queries** (e.g. `parsers/ ↛ cli/`, `db.ts ↛ adapters/`, `adapters/ ↛ application/` direction, `cli/ ↛ db.ts` direction) **+ 1 primitive-layer query** (whatever stays as the most-leaf module). Derive from `architecture.md` — don't invent.

For a re-runnable kit, find the most recent open or recently-closed audit under `docs/audits/` and copy its § Boundary verification block. **Don't cite a specific audit file by name from this skill** — audits are mortal under [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md), and naming one couples this skill's durability to its lifecycle.

### 3. Run the fallow PR-audit

Codemap is a TS project — fallow's PR-audit applies cleanly:

```bash
bunx fallow audit --base origin/main
```

Apply the duplication / complexity thresholds (translated from fallow's own audit-on-PR shape):

| Signal                                                                 | Verdict                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| Clone group ≥40 LoC between sibling files of the same module / adapter | **Incomplete lift** — the orchestrator wasn't shared.    |
| Clone family ≥3 groups across sibling files                            | **Structurally incomplete lift** — revisit the boundary. |
| Function size ≥60 LoC in a wrapper / orchestrator                      | **Wrapper doing orchestration**, not adapter wiring.     |
| Unused file (esp. file with the same name as one moved during the PR)  | **Dead leftover from the move** — delete.                |
| Unused export of a type / fn referenced only inside the same folder    | **Public-surface bloat** — drop the `export`.            |
| Unused dependency in `package.json`                                    | Out of scope for this audit unless the PR added it.      |

The thresholds (≥40 / ≥3) are **seed values** from fallow's own calibration. Re-tune as more codemap-shaped lifts land if the seed proves too tight or too loose.

### 4. Cross-check structural STOP signals

Walk a STOP-signal table appropriate to codemap. The default set:

| Signal                                                                                       | Verdict                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Adding a new top-level `src/<X>/` folder**                                                 | Did the PR confirm the folder has a planned public surface (an `index.ts` barrel re-exporting only the consumed bits) and isn't a horizontal `services/` + `utils/` + `types/` split? If not, propose a fix.                            |
| **Cross-module import that crosses a layer** (e.g. `src/parsers/` importing from `src/cli/`) | Per `docs/architecture.md` § Layering — usually a regression. Query is the §-2 forbidden-edge SQL.                                                                                                                                      |
| **New shared utility under `src/utils/`** projected to have **3+ consumers**                 | Shared modules are the most expensive-to-move once adopted. Propose 2–3 alternative interfaces in the findings doc; don't just accept the one shipped.                                                                                  |
| **A folder grows past ~15 files** without an `index.ts` public surface                       | Either splitting or a barrel. Document which the PR took, or flag if it took neither.                                                                                                                                                   |
| **Moving files across module boundaries** (out of `src/parsers/` into `src/adapters/`, etc.) | The "frame the problem space" step exists for this — what's the new owner, what's the contract, who else needs to know. If the PR moved files without that framing, propose a one-paragraph rationale lift into `docs/architecture.md`. |

For each signal: did this PR trigger it? If yes, did the PR address it correctly? If a signal was triggered and missed, that's a finding.

### 5. Cross-check `docs/architecture.md`

- Does the PR introduce a pattern not described there? (e.g. a new adapter shape, a new query convention, a new schema column) → **Documentation lag finding** — propose the lift into `architecture.md` per [`docs/README.md` Rule 2](../../../docs/README.md) ("when something ships, lift the description into its canonical home").
- Does the PR contradict an existing pattern? → **Pattern-drift finding** — propose a fix or an explicit `architecture.md` update saying "this pattern is being phased out."
- Does the PR change something `glossary.md` already names? → **Glossary update** finding ([`docs/README.md` Rule 9](../../../docs/README.md)).

### 6. Write the audit doc

Per [`docs-governance` § Closing an audit substrate variant](../docs-governance/SKILL.md#closing-an-audit):

- **Tier B (codemap's only active tier)** — `docs/audits/<YYYY-MM-DD>-<topic>.md` for dated targeted audits OR `docs/audits/<topic>.md` for ongoing topic audits. Topic is short kebab-case. See [`docs-governance` § 3 Naming conventions](../docs-governance/SKILL.md#3-naming-conventions).

If `docs/audits/` doesn't exist yet (codemap hasn't shipped its first audit at the time of writing), create it with a `.gitkeep` alongside the new audit file.

Doc shape — mirror the most recent audit under `docs/audits/` (or — if this is the first — use the canonical form below). Don't hardcode a specific audit filename here for the same durability reason as § 2: those files are mortal under [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md).

```md
# <Title> — <YYYY-MM-DD>

**Status:** Open — pending PR #N follow-ups (or: Closed, all N findings shipped on the same branch).
**Scope:** <one paragraph: what diff, what HEAD, what subtree(s)>.
**Method:** <codemap query + fallow audit + cross-check; cite which queries>.

This audit follows [docs/README.md Rule 6](../README.md) (no inventory counts in evergreen prose) and [docs/README.md Rule 7](../README.md) (no line-number references). All numbers below are flagged "at audit time."

---

## TL;DR

<2–4 sentences: verdict + headline finding count>.

## Architecture STOP signals — <none triggered | N triggered>

| Signal | This PR |
| ------ | ------- |
| ...    | ...     |

## Boundary verification (re-run of <prior audit / template>)

<Inline the SQL block + paste the result. Re-runnable.>

## Findings

### 1. <Title> — <category: dead code / incomplete lift / pattern drift / boundary regression / doc lag>

**What:** <evidence + which file + which query surfaced it>.

**Why it matters:** <one paragraph linking back to the rule / pattern violated>.

**Recommendation:** <preferred + alternative (e.g. "defer with roadmap entry")>.

### 2. ...

---

## Plan

1. <action> — <commit message hint>
2. ...

---

## Verification recipe

<re-runnable bash block: codemap reindex + boundary queries + fallow audit + typecheck/lint/test>.
```

## Closing this audit

Once findings are shipped (or deferred to `roadmap.md`):

1. **Update Status header**: `Status: Closed (YYYY-MM-DD) — N findings shipped on commits <hash>, <hash>, <hash>; M deferred to roadmap.md § <section>.`
2. **Add to `roadmap.md` § Closed audits (pointers)** with a one-line summary.
3. **Apply [`docs-governance`](../docs-governance/SKILL.md) § Closing an audit re-derivable test.** If the audit has no source-cites, no unique policy, no rejected-alternatives rationale → digest deferred items into `roadmap.md`, then **delete the audit file** (no tombstones). Otherwise slim per the keep-criteria.
4. **Run [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md)** if the closure changes the audit substrate (new topic file, retired old topic) so the rest of the audits/ folder stays evaluated.

## Anti-patterns

- ❌ **Editing source files during the audit.** Audit produces a findings doc + plan; execution is a separate decision. Mixing the two means findings can't be reviewed before shipping fixes.
- ❌ **Hardcoding inventory counts in the audit prose.** Per [`docs-governance`](../docs-governance/SKILL.md), counts go stale on the next material PR. Reference qualitatively ("the wrappers were 80% identical at audit time") + cite the re-runnable command.
- ❌ **Duplicating boundary queries across audits.** The forbidden-edge classes are templated above — link to this skill's § 2 instead of re-pasting the same SQL block.
- ❌ **Skipping the structural STOP-signal cross-check** because "the PR didn't trigger STOP signals at author time." It might have triggered them and the author moved past them; the audit's job is to verify, not assume.
- ❌ **Closing an audit without re-running the verification recipe** on the post-fix HEAD. Findings stay "Open" until the recipe shows them resolved.

## Reference

- [`docs-governance`](../docs-governance/SKILL.md) — audit substrate (Tier B), closing prescriptions.
- [`docs-lifecycle-sweep`](../docs-lifecycle-sweep/SKILL.md) — operationalises docs-governance lifecycle on demand.
- [`codemap`](../codemap/SKILL.md) — query patterns; the boundary-leak kit lives in § 2 here.
- [`docs/architecture.md`](../../../docs/architecture.md) — the canonical source of codemap's layering; every audit derives its boundary kit from this file.
- [fallow](https://github.com/fallow-rs/fallow) — `bunx fallow audit --base origin/main` thresholds.
- Adapted from `PaySpace/merchant-dashboard-v2` `.agents/skills/audit-pr-architecture/SKILL.md` (2026-04). Trimmed to codemap's stack (no React-feature concerns); STOP-signal table re-derived for codemap's `src/` shape.
