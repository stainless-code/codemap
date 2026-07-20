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
- **[surfaces]** `apps/docs/content/reference/env.mdx` — `CODEMAP_TEST_BENCH`: by-design — real `CODEMAP_ROOT` alias used by CLI bootstrap / benches.
- **[surfaces]** `apps/docs/content/reference/roadmap.mdx` — footer link to repo `docs/roadmap.md`: by-design — curated public subset points at maintainer SSOT.
- **[security]** `apps/docs/public/.htaccess` HSTS `includeSubDomains`: by-design — same apex-host policy as sister docs deploys; confirm with host ops if changing.
- **[surfaces]** `src/version.ts` `CODEMAP_VERSION` “inlined at build time”: out of PR diff — leave; scrub if a version-export docs PR touches that file.

<!-- Example:
- **[security]** `src/cli/proxy.ts:42` — https_proxy env: by-design — standard CLI proxy convention.
-->

## Deferred

Capped or out-of-scope-for-now — reconcile re-vets; remove lines when fixed.

```markdown
- **[severity]** `file:line` — finding (deferred: out of scope | cap | blocked)
```
