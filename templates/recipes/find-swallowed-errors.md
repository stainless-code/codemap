---
params: []
actions:
  - type: navigate-to-swallowed-errors
    description: Catch blocks that only log to console.* without rethrowing.
---

# find-swallowed-errors

Try/catch blocks whose catch body only logs to `console.*` (Tier 5 heuristic).

```bash
codemap query --recipe find-swallowed-errors
```
