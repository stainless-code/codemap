---
params:
  - name: min_crap
    type: number
    required: false
    default: 30
    description: Minimum CRAP score threshold (industry default 30)
actions:
  - type: review-crap-score
    auto_fixable: false
    description: "High CRAP (complex + undertested) — add tests or simplify before refactor. Check coverage_source: measured rows used ingested coverage; estimated rows use graph tiers only."
---

# high-crap-score

Ranks symbols by **CRAP score** — `CC² × (1 - effective_coverage/100)³ + CC` where `CC = symbols.complexity`.

**Coverage precedence:** ingested `coverage` rows win (`coverage_source: measured`) — including **0% measured**, which overrides graph tiers even when tests reference the symbol. Otherwise graph-estimated tiers (`coverage_source: estimated`) via value-only `dependencies` fan-out (type-only imports are excluded at index time):

| Tier    | When                                                                                          |
| ------- | --------------------------------------------------------------------------------------------- |
| **85%** | Symbol directly referenced from a test file (`bindings`-resolved `references` or AST `calls`) |
| **40%** | Symbol's `file_path` is dependency-reachable from any test file                               |
| **0%**  | Otherwise                                                                                     |

Estimates are **heuristics**, not execution coverage — prefer `codemap ingest-coverage` before CI gates. Composes with `high-complexity-untested` (cyclomatic + measured-only today).

```bash
codemap query --recipe high-crap-score --json
codemap query --recipe high-crap-score --params min_crap=15 --json
```
