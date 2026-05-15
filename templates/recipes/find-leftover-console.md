---
actions:
  - type: review-console-call
    auto_fixable: false
    description: "Every `console.<method>(…)` call site — column-precise. Audit before shipping production code. Filter by `method` (`detail` column) to narrow to log/warn/error/debug/etc. Filter by file path to exclude test files and scripts."
---

# find-leftover-console

Every `console.*` call in the indexed codebase. Pair with a path filter to scope to production code:

```bash
codemap query --recipe find-leftover-console

codemap query --json 'SELECT * FROM runtime_markers WHERE kind = "console" AND file_path LIKE "src/%" AND file_path NOT LIKE "%.test.%"'
```

Methods (in `detail`): `log` / `warn` / `error` / `info` / `debug` / `trace` / `dir` / `table` / `group` / `groupEnd` / `time` / etc.

Counts only direct calls (`console.log(...)`). Aliased calls (`const log = console.log; log(...)`) appear as plain `log` references — not detected.
