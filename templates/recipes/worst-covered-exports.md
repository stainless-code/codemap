---
actions:
  - type: add-test-suite
    auto_fixable: false
    description: "Exported function with low or no coverage. If callers exist (use the `calls` table to check), refactor risk goes up with every change."
---

Top 20 worst-covered exported functions — high-leverage test-writing targets.

`COALESCE(c.coverage_pct, 0) = 0` treats "no coverage row" and "0% coverage" identically. To distinguish them (e.g. if you want to know which uncovered symbols have _some_ callers), join `calls` on `callee_name = s.name`.

Pair with [`untested-and-dead`](./untested-and-dead.md) to split the result set: low-coverage symbols _with_ callers are refactor-risk; low-coverage symbols _without_ callers are dead-code candidates.

Empty until you run `codemap ingest-coverage <path>`.
