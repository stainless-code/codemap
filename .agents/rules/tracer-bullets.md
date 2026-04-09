---
description: Build features in small end-to-end slices, not big horizontal layers
alwaysApply: true
---

# Tracer Bullets

When building features, build a tiny end-to-end slice first, validate it works, then expand.

## Why

AI agents tend to produce complete solutions in one leap — all parsers, all schema, all docs — without ever testing whether the critical path works. This creates massive review burden and rework ("slop").

## Rules

1. **Start with one vertical slice** that touches all relevant layers for the simplest case
2. **Commit and validate** that slice before expanding — the pre-commit hook will run format, lint, typecheck, and tests on staged files (when AI/agent env vars trigger it)
3. **Expand outward** from the working slice in subsequent commits
4. **Never build horizontal layers in isolation** (e.g. all DB helpers before any CLI wiring, or all docs before any working index path)

## Feature layers in this project

A typical vertical slice for Codemap touches these layers top-to-bottom:

1. **CLI / orchestration** — `src/index.ts` (args, incremental vs full, `query` subcommand)
2. **Workers / parsing** — `src/parse-worker.ts`, `src/parser.ts`, `src/css-parser.ts`
3. **Persistence** — `src/db.ts` (schema, inserts, `SCHEMA_VERSION`)
4. **Config / runtime** — `src/config.ts`, `src/runtime.ts`, resolver
5. **Tests** — `src/*.test.ts`
6. **Docs** — `docs/*.md` when behavior is user-visible

## Example 1: Support a new source extension

Bad — building in layers:

- Update every glob, parser, and docs in one giant change
- Hope CI and the index agree

Good — tracer bullet:

1. **`constants` + parser language** — `LANG_MAP` + `extractFileData` / worker `TS_EXTENSIONS` — commit, `bun run check`, small test parsing a one-line file
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
