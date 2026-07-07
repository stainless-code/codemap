---
name: verify-after-each-step
description: Per-file verification checklist — lint-staged and package.json scripts after each milestone.
disable-model-invocation: true
---

# Verify after each step (full checklist)

Always-on priming: [`.agents/rules/verify-after-each-step.md`](../../rules/verify-after-each-step.md).

Run matching checks on every file touched **before** moving to the next milestone. Pre-commit is the safety net, not the first line of defense.

## Discover project scripts

1. **Read `package.json` `scripts`** at the start of a task.
2. **Read `lint-staged.config.js`** — which checks apply to which patterns (staged-only tsgo, paired co-located tests).
3. Never assume script names — verify they exist in `package.json` before running.

## Per-file check table (this repo)

From `lint-staged.config.js` — mirror these between milestones, not only at commit:

| File pattern                        | Checks                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}` | `bun run format:check`, `bun run lint`                                                                                                                                                                                                                                                                                                            |
| `*.{css,json,md,mdc,html,yaml,yml}` | `bun run format:check`                                                                                                                                                                                                                                                                                                                            |
| `*.{ts,tsx}`                        | `bun run typecheck` with a temporary `tsconfig.lint-staged.json` that includes only **staged files under `src/`** (project-wide types still interconnect — use `bun run typecheck` if you need full-project certainty); **`bun test`** on co-located `*.test.{ts,tsx}` pairs when a staged `src/` source file is present but its test file is not |
| `*.test.ts`                         | `bun test` (on changed test files)                                                                                                                                                                                                                                                                                                                |
| `*.test.tsx`                        | `bun test` (on changed test files)                                                                                                                                                                                                                                                                                                                |
| `scripts/**/*.test.mjs`             | `bun test` (on changed test files)                                                                                                                                                                                                                                                                                                                |

**Co-located pair:** `foo.ts` → `foo.test.ts` (lint-staged runs the pair when only the source is staged — mirror that here).

**Build config / entry points:** if `tsdown.config.ts`, `package.json` `exports`, or an entry module changed, add `bun run build`.

**Golden / agent eval:** if recipe SQL, schema, or golden fixtures changed, add `bun run test:golden` (and `bun run test:agent-eval` when probe scenarios depend on the index).

Full gate before commit/push: `bun run check` (build + format + lint:ci + test + test:scripts + typecheck + test:golden + test:agent-eval). `.agents/` / `docs/` / `.github/` only need `bun run format:check` unless content affects runtime.

## Re-index before querying Codemap

If you changed indexed source and plan to run SQL against the structural index next, run:

```bash
bun src/index.ts --files <paths>
```

Paths must be **relative to the indexed project root**. Set `CODEMAP_TEST_BENCH` / `CODEMAP_ROOT` or `--root` so that root is correct — see [docs/benchmark.md § Indexing another project](../../../docs/benchmark.md#indexing-another-project).

## Reference

Tier-1 priming: [`.agents/rules/verify-after-each-step.md`](../../rules/verify-after-each-step.md) · [`tracer-bullets`](../../rules/tracer-bullets.md) · [`no-bypass-hooks`](../../rules/no-bypass-hooks.md) · [`harden-pr`](../harden-pr/SKILL.md)
