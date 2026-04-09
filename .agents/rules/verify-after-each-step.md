---
description: After each working milestone, verify changed files using the same checks lint-staged runs
alwaysApply: true
---

# Verify Changed Files After Each Step

After completing a step, phase, or milestone, verify every file you touched using the project's existing checks. Don't wait for `git commit` — the pre-commit hook is a safety net, not a first line of defense.

## Why

AI agents tend to chain many edits across files and only discover breakage at commit time. By then the failing context is stale and the fix is harder. Running checks after each working milestone keeps the codebase green continuously.

## Discover Project Scripts

1. **Read `package.json` `scripts`** at the start of a task to know available commands.
2. **Read `lint-staged.config.js`** (or equivalent) to know which checks apply to which file patterns.
3. Never assume script names — always verify they exist in `package.json` before running them.

## Current Per-File Checks (from `lint-staged.config.js`)

| File pattern                        | Checks                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `*.{js,jsx,ts,tsx,mjs,mts,cjs,cts}` | `bun run format:check`, `bun run lint`                                                                                                                                                                                 |
| `*.{css,json,md,mdc,html,yaml,yml}` | `bun run format:check`                                                                                                                                                                                                 |
| `*.{ts,tsx}`                        | `bun run typecheck` with a temporary `tsconfig.lint-staged.json` that includes only **staged files under `src/`** (project-wide types still interconnect — use `bun run typecheck` if you need full-project certainty) |
| `*.test.ts`                         | `bun test` (on changed test files)                                                                                                                                                                                     |

## What Counts as a Step

A "step" is any self-contained unit of work where you've finished editing and are about to move on:

- Completed a TODO / action item from a plan
- Finished a tracer-bullet slice (see tracer-bullets rule)
- Refactored or moved code across files
- Added or modified a parser, CLI flag, schema, or test
- Fixed a bug or addressed a review comment

## Rules

1. **Verify after every step** — Run the matching checks on every file you touched during that step before moving to the next one.
2. **Fix before moving on** — If any check fails, fix it immediately while context is fresh. Never carry forward known failures.
3. **Use the right scope** — Run `bun run lint` and `bun run format:check` on specific files when possible. Prefer `bun run typecheck` project-wide when types may depend on unstaged files.
4. **Run affected tests** — If you modified or created `*.test.ts` files, run `bun test <file>` on them.
5. **Re-index before querying Codemap** — If you changed indexed source and plan to run SQL against the structural index next, run `bun src/index.ts --files <paths>` with paths **relative to the indexed project root** (set `CODEMAP_TEST_BENCH` / `CODEMAP_ROOT` or `--root` so that root is correct — see [docs/benchmark.md § Indexing another project](../../docs/benchmark.md#indexing-another-project)).
6. **Don't duplicate the hook's job** — You don't need to re-verify at commit time; the pre-commit hook (`lint-staged`) handles that automatically when AI/agent env vars trigger it. Your job is to stay green _between_ commits.
