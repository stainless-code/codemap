---
name: tdd
description: Test-driven development with vertical tracer-bullet slices. Use when building test-first, red-green-refactor, or when the user mentions TDD.
---

# Test-driven development

Vertical RED→GREEN cycles — **one behavior per loop**, not horizontal "all tests then all code". Aligns with [`tracer-bullets`](../../rules/tracer-bullets.md) and [`verify-after-each-step`](../verify-after-each-step/SKILL.md).

## This repo

- Runner split per [`docs/testing-coverage.md`](../../../docs/testing-coverage.md):
  - `bun test ./src` — co-located unit tests (parsers, DB, engines, CLI/MCP handlers). Mock at parser/DB seams.
  - `bun run test:golden` — index `fixtures/minimal`, run SQL scenarios vs committed goldens.
  - `bun run test:scripts` — `scripts/**/*.test.mjs`.
  - `bun run test:agent-eval` — probe/live agent eval harness (after golden index when applicable).
- Co-locate tests next to the module (`src/db.ts` → `src/db.test.ts`).
- After each GREEN: format/lint/typecheck per [`verify-after-each-step`](../verify-after-each-step/SKILL.md).
- Mock at the **parser or DB seam** (fake `:memory:` DB, stub adapter input), never inside the engine under test. See [`PATTERNS.md`](./PATTERNS.md).

## Workflow

### 1. Planning

Confirm **behaviors** to test (not implementation steps) with the user. Prefer deep modules — small public surface (`extractFileData`, `batchInsert`, a recipe handler), complex internals.

### 2. Tracer bullet (within slice)

```
RED:   one test for first behavior → bun test <file>   (or test:golden when recipe/SQL output is the contract)
GREEN: minimal code to pass → re-run
```

### 3. Incremental loop

For each behavior: RED → GREEN → run affected tests. One test at a time; no speculative features.

### 4. Refactor

After GREEN — look for duplication, long methods, shallow modules, feature envy. Run `bun test <file>` after each step. **Never refactor while RED.** For production polish on a completed slice, [`harden-pr`](../harden-pr/SKILL.md) lite may run in parallel with tracer-bullet commits.

## Checklist per cycle

```
[ ] Test describes behavior, not implementation
[ ] Test uses the public seam only (parser entry, DB insert path, CLI handler, recipe output)
[ ] Test would survive an internal refactor
[ ] Code is minimal for this test
[ ] bun test (or test:golden / test:scripts) passes on touched file(s)
```

## Reference

- Good/bad test patterns + mock boundaries: [`PATTERNS.md`](./PATTERNS.md)
- Slice cadence: [`tracer-bullets`](../../rules/tracer-bullets.md) · Verify: [`verify-after-each-step`](../verify-after-each-step/SKILL.md)
