---
actions:
  - type: review-deep-nesting
    auto_fixable: false
    description: "Functions with nesting depth ≥ 4 ranked by depth then complexity. Deep nesting is a stronger refactor signal than raw line count — the linear-scan reader has to keep more state in mind. Common fixes: early returns, extracted helpers, guard clauses."
---

# deeply-nested-functions

Functions with cyclomatic nesting depth ≥ 4, ranked by depth then complexity. Counts if/for/while/do/try/catch/ternary as nesting levels; switch arms and `&&` / `||` chains don't count (they're flat decision points, not depth).

```bash
codemap query --recipe deeply-nested-functions
```

Combine with `body_line_count` to triage:

- **Deep + long** (`nesting_depth >= 5 AND body_line_count > 100`) — almost always worth refactoring.
- **Deep but short** — possibly a fine state machine, possibly a recursion in a tight space.
- **Shallow but long** — a different kind of smell (often "huge switch" or "render-everything" components).
