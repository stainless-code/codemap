---
params:
  - name: name
    type: string
    required: true
    description: Identifier name to find write sites for (`count`, `state`, `error` — case-sensitive).
actions:
  - type: review-write-site
    description: "Every assignment, mutation, or declaration of `name` per R.13. Use for tracking state mutations, finding hidden reassignments, or auditing variable lifecycles. `(file_path, line_start, column_start, column_end)` is column-precise."
---

# find-write-sites

Every write to an identifier — assignments, mutations, declarations, compound updates. Joins `references.is_write = 1` with `scopes` for enclosing context.

```bash
codemap query --recipe find-write-sites --params name=count
codemap query --recipe find-write-sites --params name=errors
```

Write semantics per R.13:

- Simple assignment `x = 1` → one row.
- Compound `x += 1` / `x++` / `delete x` → one row (the write half; the read half is also emitted but lives under `find-references`).
- Declaration with initializer (`const x = …`) → one row.
- `for (x of …)` / `for (x in …)` LHS → one row.
- Destructuring `AssignmentPattern` (e.g. `function f(x = 1)`) → one row.

Useful for: hidden reassignment detection (variables that look `const` but get reassigned), state-mutation auditing, or finding every place a parameter gets re-bound. JOIN with `symbols` (`kind = 'const'`) to find `const`s that get illegally written.
