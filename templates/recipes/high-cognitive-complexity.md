---
params:
  - name: min_score
    type: number
    required: false
    default: 15
    description: Minimum SonarSource cognitive complexity score (default matches Sonar rule threshold)
actions:
  - type: review-cognitive-complexity
    auto_fixable: false
    description: "Function-shaped symbols with cognitive complexity ≥ min_score — nesting-heavy control flow ranked above flat branch chains. Prefer early returns and extracted helpers."
---

# high-cognitive-complexity

Functions with **cognitive complexity** ≥ `min_score` (default **15**, Sonar-aligned). Uses the same function-shaped symbol coverage as cyclomatic `symbols.complexity` (top-level functions, named arrow/const, class methods).

Distinct from `high-complexity-untested` (cyclomatic gate + coverage) and `deeply-nested-functions` (`nesting_depth` only).

```bash
codemap query --recipe high-cognitive-complexity
codemap query --recipe high-cognitive-complexity --params min_score=20
```
