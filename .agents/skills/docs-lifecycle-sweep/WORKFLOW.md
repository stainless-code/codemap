# Docs lifecycle sweep — procedure

## The 5-step procedure

### 1. Enumerate the surface

```bash
find docs -name '*.md' -type f                                # Tier B
find .agents/rules .agents/skills -name '*.md' -type f        # Tier 0 (source-of-truth rules + skills)
find templates/agents -name '*.md' -type f                    # Tier 0 (bundled npm templates — separate authoring surface)
```

`.cursor/` is intentionally excluded — it's symlinks back to `.agents/` per [`agents-first-convention`](../../rules/agents-first-convention.md), so sweeping it would double-count. `scripts/` is .ts only (no docs to sweep). If either grows tracked `.md` files in the future, add them here.

Map each file to one of the 5 lifecycle types per [docs-governance LIFECYCLE § 1](../docs-governance/LIFECYCLE.md#1-five-lifecycle-types). If a file fits no type, that itself is a finding (rogue doc — fold + delete).

### 2. Apply the existence test

Per [docs-governance LIFECYCLE § 2](../docs-governance/LIFECYCLE.md#2-existence-test-apply-on-every-doc-touching-pr), each file earns its place if it meets ≥1 of: source cite / durable policy / open work / inbound cites require slim stub.

For each file, run the cite-check evidence command:

```bash
rg -n "<filename>(\.md)?(#[a-z0-9-]+)?" \
   --glob '!docs/**' --glob '!.agents/**' --glob '!.cursor/**' .

rg -n "Rule [0-9]+" <doc-path>           # cited rule numbers
rg -n "NOTE\(<topic>" src/ scripts/      # NOTE markers if used
```

If the file is an audit, also check the [docs-governance LIFECYCLE § Closing an audit re-derivable test](../docs-governance/LIFECYCLE.md#closing-an-audit) keep-criteria (decisions of record / source-back-references / reusable methodology).

### 3. Classify each file

Apply the tier definitions from [SKILL.md § Classification tiers](./SKILL.md#classification-tiers).

### 4. Surface the classification report (BEFORE any edits)

Present the user with a per-file table — file shape / lifecycle type / tier verdict / evidence / proposed action. Use **shape placeholders** (`<topic>`, `<feature>`) when illustrating the template.

The report includes the **executable diff preview** for every Tier B (slim) and Tier C (delete + lift). Cross-reference impact is shown: every inbound link to a Tier C file gets a "this link will need rewiring" line.

### 5. Execute on user approval

In dependency order (delete + lift before slimming so cross-refs are correct):

1. **Lift** orphan-able knowledge to its destination.
2. **Update** every inbound cross-reference (in-place edits).
3. **Delete** the source file (Tier C) or apply the slim diff (Tier B).
4. **Update cross-references** — fix inbound links to deleted paths; `architecture.md` for newly-promoted reference content; `docs/README.md § File Ownership` table for added/removed top-level docs (per [`docs/README.md` Rule 4](../../../docs/README.md)). Do not add tombstone rows for deleted audit paths.
5. **Re-grep** to confirm zero broken cross-references: `rg "<deleted-filename>"` returns 0 hits outside the deletion commit message.

After execution, the surface is **clean** by definition.

## Output substrate (the sweep report itself)

A sweep report is **transient** by design — it lives on the PR / chat where the sweep ran, not in `docs/`. The findings + chosen actions land as commit messages + cross-link updates; the report itself is not a doc to keep.

Default: don't write a meta-doc about the cleanup. Durable closure anchors are the shipping PR / commit — not a maintained list of deleted paths.
