---
actions:
  - type: review-large-function
    auto_fixable: false
    description: "Functions over 50 source lines ranked by length. Combine with `complexity` (cyclomatic) to find the ones that are both long AND branchy — those are the highest-priority refactor targets."
---

# large-functions

Functions, arrows, and methods whose `body_line_count` is ≥ 50, ranked by size — top 50 returned (`LIMIT 50` in the SQL). Joins with `complexity` (already on the row) so you can spot the ones that are both long and branchy in a single scan.

```bash
codemap query --recipe large-functions
```

Body line count = `line_end - line_start + 1` for function-shaped symbols. `param_count` is the function's parameter count. NULL for non-function symbols (consts, types, interfaces).

For deeper refactor signals, combine with `refactor-risk-ranking`.
