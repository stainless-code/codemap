---
params: []
actions:
  - type: navigate-to-definition
    description: "Each row is an async function-shaped symbol with structured return_type."
---

# find-async-functions

List every async function with its stringified return type. Tier 4 substrate — complements signature text search with queryable `is_async` / `return_type` columns.

```bash
codemap query --recipe find-async-functions
```

Filter to Promise-returning async functions:

```bash
codemap query --json "SELECT * FROM symbols WHERE is_async = 1 AND return_type LIKE 'Promise%'"
```
