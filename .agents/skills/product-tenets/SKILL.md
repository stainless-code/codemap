---
name: product-tenets
description: The product north-star — four Codemap tenets (structural over semantic, predicate-as-API, local-first / agent-native surfaces, honest scope). Use when making a design, API, or architecture decision, evaluating a trade-off, justifying a feature, or writing/reviewing a docs/plans entry.
---

# Product tenets (north-star)

These four tenets are the design north-star for `@stainless-code/codemap`; reach for them whenever a decision needs justifying. Codemap is a local codebase intelligence tool: a deterministic, AST-backed SQLite index of structural facts that an agent queries with SQL instead of scanning files — the tenets fall out of that thesis.

## 1. Structural over semantic

The index carries facts the AST and resolver can prove: symbols, imports, exports, components, calls, dependencies, CSS tokens, markers, scopes, bindings. No embeddings, no LLM-in-the-box, no relevance verdict the tool invented. The agent decides relevance; Codemap answers.

- Rules out: embedding search as a core surface; "smart" context ranking baked into the index; verdicts dressed as facts.
- Codemap shape: `symbols` / `dependencies` / `references` / `coverage` tables; opt-in FTS5 (`--with-fts`) for body search that JOINs with structure — never the foundation.

## 2. Predicate-as-API (SQL + recipes)

SQL is the API. Every structural question is a `SELECT`; every repeated pattern is a named recipe (`codemap query --recipe`). Verdicts (SARIF, annotations, exit codes) are an **output mode** of recipes, never a primitive — `codemap apply` executes diff rows you provide, it doesn't invent fixes.

- Rules out: pre-baked graph verbs that hide the query; magic "find dead code" buttons with no SQL behind them; severity engines that can't be recomposed.
- Codemap shape: `query --json` / `--print-sql` / `--recipe` / `--recipes-json`; `apply` / `apply_rows` / `apply_diff_input` over explicit rows; recipes compose (`untested-and-dead`, `boundary-violations`, `churn-complexity-hotspots`, …).

## 3. Local-first, agent-native surfaces

A small SQLite file on disk (`.codemap/index.db`), queried through whatever surface the agent host speaks: CLI, MCP, HTTP. No daemon required to answer; no remote service in the path. The same recipes run in a terminal, an MCP tool, a `codemap serve` route, or a GitHub Action.

- Rules out: cloud-only indexes; mandatory long-running daemons; surfaces that only work inside one editor.
- Codemap shape: `codemap` CLI verbs; MCP tools (`query`, `show`, `impact`, `trace`, `affected`, `apply`, …); HTTP `codemap serve`; GitHub Action for CI gates; `codemap agents init` wires the surface the consumer's PM prefers.

## 4. Honest scope (anti-pitch)

Say what Codemap does **not** do, on the same page that sells it. Whole-file semantic understanding, editor-time refactoring, verdict-shaped linting, and NL Q&A over the repo are someone else's slot — link to them. Non-goals are a product floor, not a backlog in disguise.

- Rules out: scope creep into embeddings / LSP-shim / verdict engine / one-shot daemon; marketing that hides the seams.
- Codemap shape: [`docs/why-codemap.md`](../../../docs/why-codemap.md) § When to reach for something else; [`roadmap.md § Non-goals (v1)`](../../../docs/roadmap.md) as a durable floor; pre-1.0 semver honesty (breaks ship in minors; schema bumps earn the `minor`).

## Using the tenets

When a proposal conflicts with a tenet, explicitly address why and how the conflict is justified (a `docs/plans/` entry for new surface, inline for a line-level change). Maintainers use these as a PR checklist. Peer-tool design is **not** a tenet — reach for the underlying spec, not a rival's implementation ([`plan-pr-inspiration-discipline`](../../rules/plan-pr-inspiration-discipline.md)).

## Reference

- [`architecture-priming`](../../rules/architecture-priming.md) — STOP signals for structurally significant changes.
- [`improve-codebase-architecture`](../improve-codebase-architecture/SKILL.md) · [`docs/architecture.md`](../../../docs/architecture.md)
- [`docs-voice`](../docs-voice/SKILL.md) — public docs tone + peer framing (Canonical patterns).
- [`plan-pr-inspiration-discipline`](../../rules/plan-pr-inspiration-discipline.md) — cite specs, not peer implementations.
