# Audit delta attribution — plan

> **Status:** open · **Priority:** P2 · **Effort:** M (~2–3 weeks)
>
> **Motivator:** `audit --base <ref>` today diffs structural rows as flat `added` / `removed` sets. PR-scoped consumers cannot tell which additions the branch introduced vs which were already present at the merge base — pre-existing debt drowns actionable deltas.
>
> **Roadmap:** [§ Recipe & audit enrichment](../roadmap.md#recipe--audit-enrichment) · builds on shipped `audit-worktree.ts` + `audit-engine.ts`

---

## Agent start here

Implement **`findingKey()`** + attribution on the **`deprecated`** delta first (smallest row shape), then generalize to `files` / `dependencies`. Do not add verdict primitives. Verify with `bun test src/application/audit-engine.test.ts src/application/audit-worktree.test.ts` after each slice.

### Key touchpoints

| File                                                                                 | What to read                                                              |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| [`src/application/audit-engine.ts`](../../src/application/audit-engine.ts)           | `V1_DELTAS`, `requiredColumns`, `runAudit`, delta diff / `added` assembly |
| [`src/application/audit-worktree.ts`](../../src/application/audit-worktree.ts)       | `.codemap/audit-cache/<sha>/`, `PopulatedCacheEntry`, base-side reindex   |
| [`src/cli/cmd-audit.ts`](../../src/cli/cmd-audit.ts)                                 | `--base` wiring; JSON envelope to stdout                                  |
| [`src/application/tool-handlers.ts`](../../src/application/tool-handlers.ts)         | MCP `audit` — envelope must match CLI                                     |
| [`src/application/audit-engine.test.ts`](../../src/application/audit-engine.test.ts) | Fixture patterns for delta column contracts                               |

### Architecture

```text
audit --base <ref>
  → git resolve ref → sha
  → audit-worktree.ensureCachedWorktree(sha)  →  .codemap/audit-cache/<sha>/index.db
  → runAuditFromRef: HEAD index + base cached index
  → per delta: compute added rows → findingKey(row) vs base key Set → attribution
  → envelope.deltas[<key>].added[].attribution  (CLI / MCP / HTTP identical)
```

### Tracer bullet (slice 1)

Branch fixture: one `@deprecated` symbol inherited from base, one introduced on branch. Assert `introduced` / `inherited` on `deprecated` delta; second `audit --base` same sha hits cache (no full reindex). Ship before MCP/HTTP doc-only pass.

### Out of scope (v1)

Baseline-prefix audits without ref-scoped key store; audit verdict + thresholds; mandatory `keys.json` sidecar (optional cache-hit optimization only).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                                                                                 | Source                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| A.1 | **Attribution is row metadata, not a verdict primitive.** Enrich delta rows (or per-delta summary) with `attribution: "introduced" \| "inherited"` — no `pass` / `warn` / `fail` field on the envelope.                                  | [Moat A](../roadmap.md#moats-load-bearing)          |
| A.2 | **Stable finding keys.** Each auditable row maps to a deterministic string key from its delta's `requiredColumns` (canonical column order, joined with `\0` or stable JSON). Same key at base SHA and at HEAD.                           | Existing `AuditDeltaSpec.requiredColumns`           |
| A.3 | **Reuse audit-cache infrastructure.** Base-side keys come from the sha-keyed extract under `.codemap/audit-cache/<sha>/` (already populated by `git archive` + reindex). Cache key snapshots alongside or derived from the cached index. | [architecture § audit-worktree](../architecture.md) |
| A.4 | **`--base` path only for v1 attribution.** Baseline-prefix audits (`source: "baseline"`) keep today's flat `added`/`removed` shape unless a follow-up adds historical key stores in `query_baselines`.                                   | Tracer bullet — ship ref-scoped first               |
| A.5 | **Composable CI.** Consumers filter `added` where `attribution === "introduced"` via SQL/`jq`; complements deferred [audit verdict + thresholds](../roadmap.md#core-substrate--platform).                                                | Roadmap trigger-gated verdict item                  |

---

## Envelope shape (sketch)

```json
{
  "head": { "commit": "abc123", "indexed_at": "…" },
  "deltas": {
    "deprecated": {
      "base": { "ref": "origin/main", "sha": "def456", "source": "ref" },
      "added": [
        {
          "name": "foo",
          "kind": "function",
          "file_path": "src/a.ts",
          "attribution": "introduced"
        },
        {
          "name": "bar",
          "kind": "function",
          "file_path": "src/b.ts",
          "attribution": "inherited"
        }
      ],
      "removed": [],
      "summary": { "added_introduced": 1, "added_inherited": 1, "removed": 0 }
    }
  }
}
```

`summary` counts are optional convenience when `summary: true`; full rows always carry `attribution` on each `added` row when `--base` is set.

---

## Implementation steps

1. **`findingKey(row, spec)`** — pure helper in `audit-engine.ts`; unit-test collision resistance on v1 delta fixtures.
2. **Base key snapshot** — after base reindex in `audit-worktree` populate path, compute `Set<string>` per delta from cached DB (or persist `keys.json` next to cached `index.db` for cache-hit fast path).
3. **`computeDelta` attribution pass** — for `source: "ref"` audits, tag each `added` row introduced vs inherited by key membership in base set; `removed` rows unchanged.
4. **CLI / MCP / HTTP parity** — same envelope on `codemap audit --base`, MCP `audit`, HTTP `POST /tool/audit`; document in tool description.
5. **`--changed-since` synergy** — document that attribution + `changed_since` on recipe queries are complementary (attribution = merge-base keys; changed_since = file-path filter).
6. Tests — extend `audit-worktree.test.ts` + `audit-engine.test.ts` with a branch that adds one deprecated symbol vs inherits one from base.
7. Docs — `architecture.md` audit envelope §; optional `glossary.md` entry for `attribution` / finding key.

---

### Verification

```bash
bun test src/application/audit-engine.test.ts src/application/audit-worktree.test.ts
bun src/index.ts audit --base origin/main --json   # branch fixture: check added[].attribution
```

MCP/HTTP: same envelope via `tool-handlers` audit handler — spot-check JSON shape after CLI green.

---

## Acceptance

- [ ] Branch-only new deprecated symbol → `attribution: "introduced"`; symbol already at base → `inherited`
- [ ] Second `audit --base` against same sha reuses cache (no full reindex) and returns identical attribution
- [ ] No new verdict-shaped CLI flag
- [ ] MCP/HTTP/CLI envelopes match

---

## Dependencies

- Shipped: `audit-worktree.ts`, `runAuditFromRef`, v1 delta registry (`files`, `dependencies`, `deprecated`)
- Independent of [audit verdict + thresholds](../roadmap.md#core-substrate--platform) (trigger-gated)
