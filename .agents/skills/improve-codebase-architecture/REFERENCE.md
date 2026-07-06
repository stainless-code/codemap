# Reference

> **See also [LANGUAGE.md](./LANGUAGE.md)** for the vocabulary every recommendation uses (module, interface, depth, seam, adapter, leverage, locality, deletion test). Read it before applying the dependency categories below — the categories assume the vocabulary.
>
> Domain terms live in [`docs/glossary.md`](../../../docs/glossary.md); canonical layering in [`docs/architecture.md`](../../../docs/architecture.md). Don't re-litigate either without marking the conflict explicitly.

## Dependency Categories

When assessing a candidate for deepening, classify its dependencies:

### 1. In-process

Pure computation, in-memory state, no I/O. Always deepenable — merge the modules and test directly.

> **Examples in this repo.** Most of `src/application/query-engine.ts` and `search-query-parser.ts` (SQL composition, field parsing). `src/application/output-budget.ts` (adaptive snippet caps). `batchInsert()` and schema helpers in `src/db.ts` (pure tuple batching over in-memory rows). `src/parser.ts` symbol extraction (oxc AST → structured rows — the AST walk itself is in-process once the parse result is in hand).

### 2. Local-substitutable

Dependencies that have local test stand-ins. Deepenable if the test substitute exists. The deepened module is tested with the local stand-in running in the test suite.

> **Examples in this repo.** In-memory SQLite (`:memory:` or temp-file DB) doubles for `.codemap/index.db` in `bun:test` — most engine tests exercise `query-engine`, `show-engine`, and `impact-engine` without a full project tree. Fixture trees under `fixtures/` double for real repos during index tests. Worker pool tests can use a single-threaded parse path or stub worker messages without spawning real `worker_threads`. `templates/recipes/` fixture SQL doubles for live recipe catalog rows when testing `recipes-loader.ts`.

### 3. Remote but owned (Ports & Adapters)

Your own services across a transport boundary (MCP stdio, HTTP, a future cloud sync). Define a port (interface) at the module boundary. The deep module owns the logic; the transport is injected. Tests use an in-memory adapter. Production uses the real adapter.

Recommendation shape: "Define a handler port on `application/tool-handlers.ts` (already the seam), implement an in-memory test harness and the MCP/HTTP transport adapters for production, so query/audit/context logic stays one deep module even though agents reach it over JSON-RPC."

> **Examples in this repo.** `application/query-engine.ts` + `application/tool-handlers.ts` are transport-agnostic; `application/mcp-server.ts` and `application/http-server.ts` are adapters. Deepening the handler layer keeps CLI, MCP, and HTTP aligned without triplicating orchestration. Async index over a future remote worker would satisfy the same `LanguageAdapter` / `ParsedFile` port at the parse seam.

### 4. True external (Mock)

Third-party services you don't control (`oxc-parser`, `lightningcss`, `better-sqlite3` / `bun:sqlite`, `chokidar`, `tinyglobby`). Mock at the boundary. The deepened module takes the external dependency as an injected port, and tests provide a mock / stand-in.

> **Examples in this repo.** `oxc-parser` (`src/parser.ts` is the adapter; tests use fixture source strings or stubbed parse results). `lightningcss` (`src/css-parser.ts`). Runtime-specific SQLite drivers (`src/sqlite-db.ts` — Bun vs Node split). `chokidar` in `application/watcher.ts` (inject a fake filesystem event source in unit tests). Resolver (`src/resolver.ts` via `oxc-resolver`) when tests need deterministic import edges without a real `tsconfig`.

## Seam discipline

(Distilled from the principles in [LANGUAGE.md § Principles](./LANGUAGE.md#principles).)

- **One adapter means a hypothetical seam. Two adapters means a real one.** Don't introduce a port unless at least two adapters are justified. Concrete example: **`LanguageAdapter`** with TS (`parser.ts`), CSS (`css-parser.ts`), and text (`markers.ts`) adapters IS a real seam — a single mega-parser pretending all extensions share one AST would invent a hypothetical seam to remove a real one. **`application/` vs `cli/`** is another real seam: programmatic API + lazy CLI chunks are two entry adapters over the same engines.
- **Internal seams vs external seams.** A deep module can have internal seams (private to its implementation, used by its own tests) as well as the external seam at its interface. Don't expose internal seams through the interface just because tests use them. Concrete example: `run-index.ts` composes glob collection, worker pool, resolver pass, and bulk insert internally; callers see `runCodemapIndex` / `Codemap.index`, not each sub-step.
- **Replace, don't layer.** Once tests live at the new external seam, the per-internal-seam unit tests on the parts you just deepened become waste — delete them in the same commit as the deepening.

## Testing Strategy

The core principle: **replace, don't layer.**

- Old unit tests on shallow modules are waste once boundary tests exist — delete them.
- Write new tests at the deepened module's interface boundary.
- Tests assert on observable outcomes through the public interface, not internal state.
- Tests should survive internal refactors — they describe behaviour, not implementation.

For boundary-enforcement candidates (rather than module-deepening), the equivalent is an **architectural regression test** at the enforced seam: import-graph scan, static source gate, or a recipe-backed assertion kept alongside the config that enforces it. Enumerate import sites with [`codemap query`](../codemap/SKILL.md) — not `Grep` — before proposing a rule.

## Boundary enforcement

Codemap enforces architecture at two complementary layers:

### Index-backed boundaries (`boundaries` config)

Users declare `boundaries: [{name, from_glob, to_glob, action?}]` in `<state-dir>/config.{ts,js,json}`. Every index pass reconciles `boundary_rules` in `src/db.ts`; the bundled **`boundary-violations`** recipe joins `dependencies` × `boundary_rules` and surfaces forbidden import edges. Plans that propose a new seam should include the exact config block **and** a `codemap query --recipe boundary-violations` dry-run expectation.

Canonical layering to respect (see [`docs/architecture.md` § Layering](../../../docs/architecture.md#layering)):

- **`application/` engines never import `cli/`** — transport-agnostic core.
- **Parsers / adapters feed `db.ts`; engines read the index** — don't let CLI flags leak into `query-engine`.
- **`templates/agent-content/**`(live-served) vs`templates/agents/**` (init-copied)** — consumer-surface split per [`.agents/rules/consumer-surfaces.md`](../../rules/consumer-surfaces.md).

When a candidate needs post-merge structural review, fire [`audit-pr-architecture`](../audit-pr-architecture/SKILL.md) on the PR range.

### oxlint (style + import hygiene)

This repo runs **oxlint** (repo-root `.oxlintrc.json`) for general lint — not as the primary architectural boundary system. Use **`import/no-cycle`** and **`eslint/no-restricted-imports`** when a plan needs directional import bans codified in source (e.g. blocking `application/` → `cli/` value imports). Nested configs must **`extends`** the parent — oxlint does not auto-merge (same caveats as persist's REFERENCE).

Example leaf for an application-layer gate:

```json
{
  "$schema": "../../node_modules/oxlint/configuration_schema.json",
  "extends": ["../.oxlintrc.json"],
  "files": ["src/application/**"],
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          {
            "group": ["**/cli/**"],
            "message": "application/ is transport-agnostic — call engines, not CLI chunks."
          }
        ]
      }
    ]
  }
}
```

Prefer **`boundary-violations`** for cross-folder import policy that should appear in CI/SARIF alongside other recipes; prefer **oxlint** for compile-time gates on known bad import shapes.

## Plan Template

Plan files live at `docs/plans/<short-kebab-name>.md`. Use this template:

```md
# <Plan title>

> Plan owner: <name or "open">. Status: **Draft / In progress / Landed**. Link from `docs/roadmap.md`.

## Problem

Describe the architectural friction:

- Which modules are shallow / which seam is currently unenforced.
- What integration risk exists in the seams between them.
- Why this makes the codebase harder to navigate, modify, or test.
- (If applicable) the inline `NOTE(...)` markers in source that point here.

## Proposed Interface (or Boundary)

The chosen design from Step 5–6 of the skill (or [INTERFACE-DESIGN.md](./INTERFACE-DESIGN.md)):

- Interface signature (types, methods, params), or the post-refactor `src/` shape + the boundary config / lint rule that enforces it.
- Usage example showing how callers use it.
- What complexity / which import classes it hides / forbids.

## Dependency Strategy

Which category from `REFERENCE.md` applies and how dependencies are handled:

- **In-process**: merged directly.
- **Local-substitutable**: tested with [specific stand-in] (in-memory SQLite, fixture tree, stub worker messages).
- **Ports & adapters**: port definition, production adapter, test adapter.
- **Mock**: mock boundary for external services (`oxc-parser`, `lightningcss`, runtime SQLite driver, `chokidar`).

## Migration

- **Import sites to update**: enumerate via `codemap query` / `query_recipe fan-in` — don't guess.
- **Backwards-compatible re-exports** (if any) and the deprecation window (changeset entry).
- **Order of operations**: the smallest landing-safe slices ([tracer bullets](../../rules/tracer-bullets.md)).

## Testing Strategy

- **New boundary tests to write**: describe the behaviours to verify at the interface.
- **Architectural regression test** (if a boundary candidate): gate test or recipe assertion to add.
- **Old tests to delete**: list shallow-module tests that become redundant after the refactor.
- **Test environment needs**: which fixture tree, in-memory DB, or transport stub.

## Glossary impact

- Terms in [`docs/glossary.md`](../../../docs/glossary.md) that get renamed, added, or have their canonical name changed by this plan. Update glossary on the same PR. If the term is genuinely domain-bearing and there's no glossary entry yet, recommend [`domain-modeling`](../domain-modeling/SKILL.md) first.

## Inspiration / specs

- Open-spec sources consulted (LSP, SQLite, oxc, MCP, Lightning CSS) per [plan-pr-inspiration-discipline](../../rules/plan-pr-inspiration-discipline.md) — cite primitives, not peer-tool implementations.

## Out of scope

- Things that look related but explicitly aren't part of this plan (so reviewers don't expect them).

## Open questions

- Anything the plan author needs a maintainer / domain expert to answer before / during execution.
```

## Project-specific conventions

- **File naming**: don't add a `-plan` suffix — the `plans/` folder provides context. `docs/plans/<short-kebab-name>.md`.
- **Roadmap link format**: `[<title>](./plans/<file>.md)` under the appropriate section in `docs/roadmap.md`.
- **Boundary candidates** should propose the exact `boundaries` config block and/or `.oxlintrc.json` override in the same plan — see [Boundary enforcement](#boundary-enforcement) above.
- **Consumer-surface changes**: when the candidate touches `package.json` `exports`, bundled agent templates (`templates/agent-content/**`, `templates/agents/**`), CLI help, or root `README.md`, the plan must include the migration path for every consumer-reachable import (and a changeset entry). Enumerate via `package.json` `exports` + [`codemap query`](../codemap/SKILL.md) — don't guess.
- **Pure dead-code removal is not a plan candidate.** Those go directly into `docs/roadmap.md`. This skill is for plans that need design discussion.
- **Glossary cross-reference**: when the proposal renames or introduces a domain term, link to (and on the same PR, update) [`docs/glossary.md`](../../../docs/glossary.md). If there's no entry yet and the term is genuinely domain-bearing, recommend [`domain-modeling`](../domain-modeling/SKILL.md) first.
- **Ship discipline**: decisions of record lift into [`docs/architecture.md`](../../../docs/architecture.md) on merge; delete the plan file per [docs-governance](../docs-governance/SKILL.md) — no "slim & keep in plans/".
