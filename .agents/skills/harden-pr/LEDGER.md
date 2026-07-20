# Harden-pr ledger

Single durable backlog for [`harden-pr`](./SKILL.md). Parent reads **§ Rejections** at vet step; **§ Deferred** on cap and on `/harden-pr reconcile`.

## Rejections

By-design or false-positive findings — do not re-raise.

```markdown
- **[category]** `file:line` — label: reason
```

- **[correctness]** `src/application/impact-engine.ts:147` — explicit inPath on single-definition symbol enables first-hop scopeFiles: by-design — matches show `--in` disambiguation (plan P2.1).
- **[correctness]** `src/application/impact-engine.ts:162` — per-file walk LIMIT before global dedup: by-design v1 — plan architecture per-defining-file walks; global limit still applies at slice.
- **[docs]** `apps/docs/pages/_home/FinalCta.astro` — `pnx` typo: by-design — [`pnx`](https://pnpm.io/cli/pnx) is pnpm's `dlx` alias (user-locked homepage wording).
- **[surfaces]** homepage InstallBox bunx-only vs getting-started multi-PM tabs: by-design — hero chip stays single-command; guides own `package-install` tabs.

<!-- Example:
- **[security]** `src/cli/proxy.ts:42` — https_proxy env: by-design — standard CLI proxy convention.
-->

## Deferred

Capped or out-of-scope-for-now — reconcile re-vets; remove lines when fixed.

```markdown
- **[severity]** `file:line` — finding (deferred: out of scope | cap | blocked)
```
