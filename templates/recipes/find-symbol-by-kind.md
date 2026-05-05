---
params:
  - name: kind
    type: string
    required: true
    description: Symbol kind to match (function, const, class, interface, ...)
  - name: name_pattern
    type: string
    required: true
    description: SQL LIKE pattern for the symbol name
actions:
  - type: inspect-symbols
    description: Review matching symbols and narrow with kind / name_pattern if needed.
---

# Find symbols by kind

Example parametrised recipe for agents and scripts.

Use when you know the structural symbol kind and want a narrow name match without writing SQL:

```bash
codemap query --json --recipe find-symbol-by-kind --params kind=function,name_pattern=%Query%
```

`name_pattern` is passed to SQLite `LIKE` unchanged. Use `%` and `_` deliberately.
