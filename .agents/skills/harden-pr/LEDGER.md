# Harden-pr ledger

Single durable backlog for [`harden-pr`](./SKILL.md). Parent reads **§ Rejections** at vet step; **§ Deferred** on cap and on `/harden-pr reconcile`.

## Rejections

By-design or false-positive findings — do not re-raise.

```markdown
- **[category]** `file:line` — label: reason
```

- **[correctness]** `src/application/impact-engine.ts:147` — explicit inPath on single-definition symbol enables first-hop scopeFiles: by-design — matches show `--in` disambiguation (plan P2.1).
- **[correctness]** `src/application/impact-engine.ts:162` — per-file walk LIMIT before global dedup: by-design v1 — plan architecture per-defining-file walks; global limit still applies at slice.

<!-- Example:
- **[security]** `src/cli/proxy.ts:42` — https_proxy env: by-design — standard CLI proxy convention.
-->

## Deferred

Capped or out-of-scope-for-now — reconcile re-vets; remove lines when fixed.

```markdown
- **[severity]** `file:line` — finding (deferred: out of scope | cap | blocked)
```
