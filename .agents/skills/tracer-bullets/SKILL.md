---
name: tracer-bullets
description: Codemap feature layers and worked tracer-bullet examples — vertical slices for new source extensions, SQLite schema changes, and CLI flags. Use when planning a feature as a tracer bullet and deciding slice boundaries across CLI/parser/db/test/docs layers.
disable-model-invocation: true
---

# Tracer bullets — codemap feature layers and examples

Always-on rule: [`.agents/rules/tracer-bullets.md`](../../rules/tracer-bullets.md) (the 5 rules + lite-harden). This skill carries the codemap layer map and worked examples.

## Feature layers in this project

A typical vertical slice for codemap touches these layers top-to-bottom:

1. **CLI / orchestration** — `src/cli/` (`bootstrap.ts`, `main.ts`, lazy `cmd-*` chunks; entry `src/index.ts`)
2. **Workers / parsing** — `src/parse-worker.ts` / `parse-worker-node.ts`, `parse-worker-core.ts`, `src/parser.ts`, `src/css-parser.ts`, `src/adapters/`
3. **Persistence** — `src/db.ts` (schema, inserts, `SCHEMA_VERSION`)
4. **Config / runtime** — `src/config.ts`, `src/runtime.ts`, resolver
5. **Tests** — `src/*.test.ts`
6. **Docs** — `docs/*.md` when behavior is user-visible

## Example 1: Support a new source extension

Bad — building in layers:

- Update every glob, parser, and docs in one giant change
- Hope CI and the index agree

Good — tracer bullet:

1. **`constants` + adapter** — `LANG_MAP` + builtin adapter extensions + `extractFileData` — commit, `bun run check`, small test parsing a one-line file
2. **Resolver** — `resolver` extensions if needed — commit, validate
3. **Docs** — `docs/architecture.md` table row — commit, validate

## Example 2: Add a new SQLite column or table

Bad — schema + all call sites + benchmarks in one unreviewable diff.

Good — tracer bullet:

1. **Schema + insert path** — `db.ts` + one write path exercised by a test or CLI run — commit, validate
2. **Readers / query UX** — expose in `query` or docs — commit, validate
3. **Benchmark / fixtures** — if numbers matter — separate commit

## Example 3: New CLI flag

Bad — flag parsing, help text, config, and tests all speculative.

Good — tracer bullet:

1. **Parse flag + minimal behavior** — e.g. `--dry-run` that only logs — commit, test
2. **Wire to real work** — connect to indexer — commit, validate
3. **Document** — README / `docs/architecture.md` — commit

## Commit cadence

Each commit should represent a functional, describable milestone — not a placeholder. Every tracer bullet is a shippable slice that works end-to-end, even if the feature isn't complete yet. Small commits get validated by the pre-commit hook and are easier to review and revert.

Before opening a PR, run [`harden-pr`](../harden-pr/SKILL.md) in **full** mode on `origin/main...HEAD` (or accept the offer when the plan checklist is complete).
