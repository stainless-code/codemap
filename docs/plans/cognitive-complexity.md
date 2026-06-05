# Cognitive complexity substrate — plan

> **Status:** open · **Priority:** P2 · **Effort:** M (~2 weeks)
>
> **Motivator:** `symbols.complexity` stores cyclomatic (McCabe) counts only. Agents and recipes (`high-complexity-untested`, future churn-hotspots JOINs) lack **cognitive complexity** — a separate signal that penalizes nesting and non-linear control flow more than flat branch chains. Surfacing both axes improves refactor-priority ranking without new verdict verbs.
>
> **Roadmap:** [§ Core substrate & platform](../roadmap.md#core-substrate--platform)

---

## Agent start here

Extend **`createComplexityTracker`** in one oxc visitor pass (R.1 single-pass — no second AST walk). Ship **column + migration + one parse fixture** before the bundled recipe. Follow [`substrate-extraction.md`](./substrate-extraction.md) tier patterns for schema bump.

### Key touchpoints

| File                                                                                                     | What to read                                               |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [`src/extractors/complexity.ts`](../../src/extractors/complexity.ts)                                     | `createComplexityTracker`, `complexityExtractor`, `popTop` |
| [`src/parser.ts`](../../src/parser.ts)                                                                   | `complexity: createComplexityTracker(symbols)` wiring      |
| [`src/db.ts`](../../src/db.ts)                                                                           | `symbols` table — add `cognitive_complexity`               |
| [`templates/recipes/high-complexity-untested.sql`](../../templates/recipes/high-complexity-untested.sql) | Optional SELECT extension in v2                            |
| Parser / golden fixtures                                                                                 | Nested-`if` fixture asserting cognitive > cyclomatic       |

### Architecture

```text
oxc visitor (existing complexity walk)
  → cognitive counter + nesting stack (parallel to cyclomatic)
  → symbol row: complexity + cognitive_complexity + nesting_depth
recipe high-cognitive-complexity
  → SQL filter on cognitive_complexity >= :min_score
```

### Tracer bullet (slice 1)

1. Tracker increments on nested `if` fixture (cognitive > cyclomatic). 2. `SCHEMA_VERSION` bump + migration. 3. Reindex self or fixture. Recipe in slice 2.

### Out of scope (v1)

Replacing cyclomatic `complexity`; Sonar-exact parity certification (match spec behavior on fixtures, not full corpus diff).

---

## Pre-locked decisions

| #   | Decision                                                                                                                                                                            | Source                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| C.1 | **New column** `symbols.cognitive_complexity INTEGER` — nullable; populated for function-scoped symbols same as cyclomatic.                                                         | [Moat B](../roadmap.md#moats-load-bearing)                                                        |
| C.2 | **Same extractor walk** — extend `complexityExtractor` / `createComplexityTracker` in one oxc visitor pass; no second AST traversal.                                                | [substrate-extraction R.1](./substrate-extraction.md#pre-locked-decisions)                        |
| C.3 | **SonarSource cognitive rules** — increment on breaks in linear flow; nesting increment when entering `if`/`loop`/`catch`/`switch`; boolean sequence handling per published spec.   | [SonarSource cognitive complexity spec](https://www.sonarsource.com/docs/CognitiveComplexity.pdf) |
| C.4 | **Moat-A exposure** — parametrised recipe `high-cognitive-complexity` (threshold param); optionally extend `high-complexity-untested` with `cognitive_complexity` column in SELECT. | Moat A                                                                                            |
| C.5 | **Keep cyclomatic** — do not replace `complexity`; recipes choose axis via SQL.                                                                                                     | Backwards compat                                                                                  |

---

## Implementation steps

1. Extend `ComplexityTracker` with cognitive counter + nesting penalty stack (parallel to cyclomatic stack).
2. Wire increments on `IfStatement`, loops, `catch`, `switch`, `&&`/`||` sequences per spec (unit-test small fixtures).
3. `popTop()` writes `cognitive_complexity` onto symbol row alongside `complexity` / `nesting_depth`.
4. `SCHEMA_VERSION` bump + migration in `db.ts`.
5. Bundled recipe `high-cognitive-complexity` (`params: min_score`, default 15).
6. Golden parse fixture: nested `if` chain — cognitive > cyclomatic.
7. Docs — `architecture.md` `symbols` columns; `glossary.md` disambiguate cyclomatic vs cognitive.

---

### Verification

```bash
bun test src/parser.test.ts                    # nested-if fixture
bun src/index.ts --files <fixture-path>
bun src/index.ts query --recipe high-cognitive-complexity --json
bun run typecheck                              # SymbolRow + db migration
```

---

## Acceptance

- [ ] Nested control-flow fixture: `cognitive_complexity` > `complexity`
- [ ] Flat `if` chain: cognitive ≈ cyclomatic (within spec tolerance)
- [ ] Incremental reindex updates column for changed files
- [ ] No new CLI verdict verb

---

## Open decisions (impl PR)

| #   | Question                                                                |
| --- | ----------------------------------------------------------------------- |
| Q1  | Populate cognitive for arrow fns / methods only, or all function kinds? |
| Q2  | Default `min_score` for `high-cognitive-complexity` recipe (15 vs 20)?  |
| Q3  | Extend `high-complexity-untested` SELECT in v1 or defer to v2?          |

---

## Dependencies

- Shipped: `src/extractors/complexity.ts`, `symbols.complexity`, `high-complexity-untested` recipe
- Synergy: [churn-complexity-hotspots](./churn-complexity-hotspots.md) may JOIN cognitive column in v2 recipe param
