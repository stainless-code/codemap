# FTS default-on evaluation — plan

> **Status:** open · **Priority:** P2 · **Effort:** S–M (~1 week measure + decision)
>
> **Motivator:** Body search requires `--with-fts` / `fts5: true` today. Agents miss content matches unless configured. Default-on improves discoverability but may inflate `.codemap/index.db` size and index time.
>
> **Roadmap:** [§ Floors — Full-text search default-on](../roadmap.md#floors-v1-product-shape) · [agent-surface-and-ops § P2](./agent-surface-and-ops.md#p2)

---

## Pre-locked decisions

| #   | Decision                                                                                                    | Source                    |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------- |
| L.1 | **Measure before flipping default** — benchmark 3 fixture sizes for index time + DB bytes with/without FTS. | Empirical gate            |
| L.2 | If adopted: change **`config.ts` default** `fts5: true` for new projects only; existing configs unchanged.  | No silent behavior change |
| L.3 | **`--with-fts` / `--no-fts`** CLI flags continue to override.                                               | Explicit escape hatch     |
| L.4 | Document size tax in README + packaging.md.                                                                 | Transparency              |

---

## Measurement protocol

1. Fixtures: codemap self-index, medium TS app (~500 files), large OSS snapshot (public, cached in CI)
2. Metrics: `index.db` bytes, full index wall ms, FTS populate phase ms
3. Threshold proposal: if median size increase <40% and index increase <15%, recommend default-on
4. Record results in `docs/benchmark.md` § FTS size tax

---

## Implementation steps (if approved)

1. Update `codemapUserConfigSchema` default `fts5: true`
2. Update README quickstart to mention opt-out
3. Ensure `ensureStateConfig` doesn't overwrite user false
4. Golden tests unchanged (FTS-specific recipes already gated)

---

## Acceptance

- [ ] Benchmark table published with decision rationale
- [ ] If default-on: new init gets FTS without extra flags
- [ ] If stay opt-in: document why with numbers

---

## Dependencies

- Synergy with field-qualified `show --query` / `snippet --query` ([agents.md](../agents.md)) when FTS joins symbol filters

---

## Outcome

Plan closes with **Adopt** or **Defer** header update — no perpetual open state.
