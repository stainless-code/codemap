# Callback dispatch synthesis — plan

> **Status:** open · **Priority:** P2 · **Effort:** L (~2–3 weeks) · **Trigger-gated**
>
> **Motivator:** Static AST `calls` edges miss JSX parent→child composition (and later EventEmitter / `setState`→render). Call-path and impact queries stop early on real TS/React codebases without heuristic edges — but heuristics must be tagged so agents don't treat them as type-checked facts.
>
> **Roadmap:** [§ Agent & indexing ops — P2](../roadmap.md#agent--indexing-ops)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                     | Source                                     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| L.1 | Add **`calls.provenance`** column — values `NULL` (legacy ast), `'ast'`, `'heuristic'`. Default NULL = ast-era rows treated as ast.          | [Moat B](../roadmap.md#moats-load-bearing) |
| L.2 | Synthesis runs **post-index pass** after bindings — additive only; failures ignored.                                                         | Optional enrichment                        |
| L.3 | **Moat-A filters** — recipes default `WHERE provenance IS NULL OR provenance = 'ast'`; opt-in recipe `calls-including-heuristic`.            | Honesty                                    |
| L.4 | **TS/React scope v1 (shipped in #164):** JSX child component edges only. EventEmitter / `setState` deferred. Skip Flutter/C++/Java patterns. | TS/JS focus                                |

---

## Heuristics (v1)

| Pattern                                    | Edge                             |
| ------------------------------------------ | -------------------------------- |
| `.on('event', handler)` / `.emit('event')` | emitter → handler                |
| JSX `<Child />` in component body          | parent component → Child symbol  |
| `setState` in class component              | method → render (low confidence) |

Cap fan-out per file to limit false positives.

---

## Implementation steps

1. SCHEMA_VERSION bump — `ALTER`/rebuild adds `calls.provenance`
2. **`src/application/callback-synthesis.ts`** — scan files (or use jsx_elements table); insert synthetic `calls` rows
3. Run from `index-engine.ts` after `deleteHeuristicCalls` + `resolveCalls` (when `synthesis.heuristicCalls` is true)
4. Recipe: `calls-including-heuristic`, update `call-path` docs
5. Tests — JSX parent→child fixture + provenance tags (`callback-synthesis.test.ts`; minimal bench `src/bench/jsx-synthesis/`)
6. Document limits in skill + MCP instructions (Moat-A filter + `calls-including-heuristic`)

---

## Acceptance (tracer in #164)

- [x] `calls.provenance` + SCHEMA 37; heuristic edges tagged when synthesis enabled
- [x] Moat-A surfaces exclude heuristics; opt-in `calls-including-heuristic` recipe
- [x] Synthesis off by default; stale heuristic rows purged on each resolve scope
- [ ] EventEmitter / setState heuristics
- [x] JSX fixture + integration test with `synthesis.heuristicCalls: true` (`callback-synthesis-integration.test.ts`)
- [x] Agent-content Moat-A + `calls-including-heuristic` notes

---

## Dependencies

- Base call resolution shipped [#162](https://github.com/stainless-code/codemap/pull/162) (`resolveCalls`, `unresolved_calls`) — see [architecture.md](../architecture.md)
- Improves MCP `trace` / `explore` / `node` usefulness (shipped #134)

---

## Config (optional)

`config.synthesis.heuristicCalls: boolean` — default `false` in v1 (#164); may flip to `true` after bake-in.
