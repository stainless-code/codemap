# In-repo test bench (no external corpus)

**Status:** Open — Phase 1–3 in progress on `feat/unresolved-calls-staging`; Phase 4 backlog.  
**Effort:** M (ongoing; expand incrementally).  
**Supersedes for maintainers:** relying on Tier B `CODEMAP_ROOT` / private clones to validate Codemap itself.

## Problem

`fixtures/minimal` + `test:golden` already cover **all 58 bundled recipes** and most indexed tables, but the name “minimal” and Tier B docs imply a **second, external tree** is needed for realism. Contributors should have **one committed bench** inside this repo.

## Goal

| Audience        | Outcome                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| **CI**          | `bun run check` proves index + recipes + substrate without `CODEMAP_*`   |
| **Maintainers** | `fixtures/CAPABILITIES.json` maps capability → source files → golden ids |
| **Consumers**   | Tier B (`test:golden:external`) stays optional for _their_ apps only     |

## Architecture

```text
fixtures/
  README.md              ← test bench entry (this plan)
  CAPABILITIES.json      ← manifest (validated in test:scripts)
  minimal/               ← corpus (grow in place or add bench/* slices)
  golden/scenarios.json
  golden/minimal/*.json
```

**Do not** add proprietary or gitignored source trees. **Do** add small, intentional files under `fixtures/minimal/` per capability gap.

## Phases

### Phase 1 — Document + guard (shipped)

- [x] `fixtures/README.md`, `fixtures/CAPABILITIES.json`
- [x] `docs/testing-coverage.md`, `query-golden-coverage-matrix.test.mjs`
- [x] Substrate pin-down goldens + `index-table-stats`
- [x] Clarify Tier B = consumer-only in `golden-queries.md`

### Phase 2 — Corpus depth

- [x] Method-call slice — `src/bench/method-call-sites.ts` + `calls-method-ping-unresolved`
- [x] Qualified heritage — `type-ancestors-qualified-child` on `heritage-qualified.ts`
- [x] `affected-tests` — six param scenarios in `scenarios.json`
- [x] Project-local recipe — `shop-symbols-recipe` golden

### Phase 3 — CLI / MCP bench pack

- [x] `src/cli/cmd-test-bench-e2e.test.ts` — show, snippet, impact, validate, `shop-symbols`, SARIF (`boundary-violations`)
- [x] `cmd-cli-parity-e2e.test.ts` — trace, explore, node, context, batch, resources
- [x] Expand `test:agent-eval` to one probe per `CAPABILITIES.json` group (18 probes; guarded by `capability-probes.test.mjs`)

### Phase 4 — Scale (optional, replaces Tier B′)

- [ ] If `minimal/` exceeds ~50 files, add `fixtures/bench/` as a **second committed corpus** with its own `scenarios.bench.json` — still in-repo, still CI
- [ ] Or: rename `minimal` → `bench` in a breaking release with path alias `fixtures/minimal` → symlink

## Non-goals

- Cloning zod/fastify/etc. into the repo (roadmap backlog stays **local** for those benchmarks)
- Replacing unit tests for parsers/CLI
- Tier B removal — keep for consumer private validation

## Validation

```bash
bun run test:scripts    # CAPABILITIES.json ↔ scenarios.json
bun run test:golden
bun run check
```

## References

- [testing-coverage.md](../testing-coverage.md)
- [golden-queries.md](../golden-queries.md)
- [fixtures/minimal/README.md](../../fixtures/minimal/README.md)
