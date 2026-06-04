# Callback dispatch synthesis — plan

> **Status:** open · **Priority:** P2 · **Effort:** L (~2–3 weeks) · **Trigger-gated**
>
> **Motivator:** Static AST `calls` edges miss EventEmitter wiring, React `setState`→render, and JSX parent→child composition. Call-path and impact queries stop early on real TS/React codebases without heuristic edges — but heuristics must be tagged so agents don't treat them as type-checked facts.
>
> **Roadmap:** [§ Agent & indexing ops — P2](../roadmap.md#agent--indexing-ops)

---

## Pre-locked decisions

| #   | Decision                                                                                                                                 | Source                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| L.1 | Add **`calls.provenance`** column — values `NULL` (legacy ast), `'ast'`, `'heuristic'`. Default NULL = ast-era rows treated as ast.      | [Moat B](../roadmap.md#moats-load-bearing) |
| L.2 | Synthesis runs **post-index pass** after bindings — additive only; failures ignored.                                                     | Optional enrichment                        |
| L.3 | **Moat-A filters** — recipes default `WHERE provenance IS NULL OR provenance = 'ast'`; opt-in recipe `calls-including-heuristic`.        | Honesty                                    |
| L.4 | **TS/React scope v1:** EventEmitter `on`/`emit`, JSX child component edges, `setState`→render heuristic. Skip Flutter/C++/Java patterns. | TS/JS focus                                |

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
3. Run from `run-index.ts` finally block (after bindings)
4. Recipe: `calls-including-heuristic`, update `call-path` docs
5. Tests — fixture with EventEmitter + JSX; assert provenance tags
6. Document limits in skill + MCP instructions

---

## Acceptance

- [ ] Heuristic edges visible with `provenance='heuristic'`
- [ ] Default call-path recipe excludes heuristics unless param set
- [ ] No change to existing ast call row counts when synthesis disabled via config flag

---

## Dependencies

- Base call resolution shipped [#162](https://github.com/stainless-code/codemap/pull/162) (`resolveCalls`, `unresolved_calls`) — see [architecture.md](../architecture.md)
- Improves MCP `trace` / `explore` / `node` usefulness (shipped #134)

---

## Config (optional)

`config.synthesis.heuristicCalls: boolean` default `true` after bake-in period.
