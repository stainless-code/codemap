# Rich `context` composer — plan

> **Status:** slice 1 shipped · **Priority:** agent session · **Effort:** M · **Motivator:** one `context` call should replace the common session-start chain (`context` → `query_recipe` fan-in → `show` on hub files → `explore` on leaders).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                               | Source                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| L.1 | **`start_here` is additive metadata** — existing `hubs`, `sample_markers`, `recipes`, and `intent` fields stay; richer blocks nest under `start_here`. | Backward-compatible envelope growth                                 |
| L.2 | **Non-compact only** — `--compact` / `compact: true` drops `start_here` alongside `hubs` and `sample_markers`.                                         | Same budget contract as today                                       |
| L.3 | **Moat-A clean** — recipe cards cite `query_recipe` invoke hints; no pre-run verdicts or row payloads inlined.                                         | [Moat A](../roadmap.md#moats-load-bearing)                          |
| L.4 | **Reuse existing recipes/SQL** — fan-in hubs + exported-symbol lookup; no new schema.                                                                  | Tracer-bullet discipline                                            |
| L.5 | **Default starters without `--for`** — session bootstrap includes explore-safe recipe cards even when `intent` is absent.                              | Roadmap goal: replace show → explore without requiring `--for` text |

---

## Envelope additions (slice 1)

```typescript
interface ContextStartHere {
  classified_as: string;
  hint: string;
  recipes: {
    id: string;
    description: string;
    tool: "query_recipe";
  }[];
  hub_leaders: {
    file_path: string;
    fan_in: number;
    signatures: { name: string; kind: string; signature: string }[];
  }[];
}
```

`ContextEnvelope.start_here?: ContextStartHere` — present when `compact: false`.

---

## Slices

### Slice 1 — `start_here` (recipe cards + hub leaders) · **this PR**

- [x] `composeStartHere()` in `context-engine.ts`
- [x] Top-5 hub files with up to 3 exported symbol signatures each (truncated)
- [x] Intent-aware recipe cards (`--for` / MCP `intent`); default explore triple when absent
- [x] Unit tests in `context-engine.test.ts`
- [x] Docs + MCP instructions mention `start_here`

**Acceptance:** `codemap context` (non-compact) emits `start_here.recipes` + `start_here.hub_leaders`; `--compact` omits it; MCP `context` tool matches CLI.

### Slice 2 — Inline index summary + intent-scoped markers

- [ ] `start_here.index_summary` — inline `index-summary` row counts
- [ ] When intent is `debug`, bias `sample_markers` toward FIXME/TODO kinds (still capped at 20)

### Slice 3 — Signature budget + adaptive caps

- [ ] Tie signature count / char cap to project file count (pairs with roadmap **Adaptive output budgets**)
- [ ] Optional `include_snippets: true` on MCP `context` (one-line export previews)

---

## Lift on ship

When all slices land: mark roadmap **Rich `context` composer** shipped; delete this plan per docs-governance (durable bits in `architecture.md` + `agents.md`).
