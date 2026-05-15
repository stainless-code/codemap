---
actions:
  - type: review-test-status
    description: "Every test block flagged as `.skip`, `.only`, or `.todo`. `.only` rows are red-flag (would silently skip everything else in CI). `.skip` and `.todo` accumulate as tech debt — track over time."
---

# find-skipped-tests

Every `describe.skip` / `it.skip` / `test.skip` / `.only` / `.todo` across the codebase, grouped by status.

```bash
codemap query --recipe find-skipped-tests
```

**`.only` is the alarm bell** — a single `it.only` left in a committed test silently disables every other test in its file. Filter for it specifically:

```sql
SELECT * FROM test_suites WHERE is_only = 1;
```

`is_skipped` / `is_todo` are usually intentional but accumulate as tech debt. Pair with git blame to find old skips that may be ready to revisit.
