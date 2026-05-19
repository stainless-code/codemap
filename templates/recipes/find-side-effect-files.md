---
params: []
actions:
  - type: navigate-to-definition
    description: "Each row is a file with module-level calls or assignments."
---

# find-side-effect-files

List files with `has_side_effects = 1` — module-level `CallExpression` or `AssignmentExpression` detected at parse time.

```bash
codemap query --recipe find-side-effect-files
```
