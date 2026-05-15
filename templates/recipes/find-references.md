---
params:
  - name: name
    type: string
    required: true
    description: Exact identifier name to find (`extractFileData`, `useState`, `MyComponent` — case-sensitive).
actions:
  - type: navigate-to-reference
    description: "Each row is a single identifier USE — value, type, or JSX. `file_path:line_start:column_start` is column-precise per R.11 (identifier token, not the surrounding expression). `is_write=1` flags assignments / declarations / `++` / `delete` per R.13. JOIN to `scopes` gives enclosing function/class for rename impact assessment."
---

# find-references

Every identifier USE matching `name` — across the entire indexed codebase — with column-precise position, write flag, and enclosing scope. The substrate behind app-wide rename, dead-symbol detection, and "where is X used?" agent queries.

```bash
codemap query --recipe find-references --params name=extractFileData
codemap query --recipe find-references --params name=useState
codemap query --recipe find-references --params name=MyComponent
```

Filter by `kind` to narrow to value / type / JSX refs:

```sql
SELECT * FROM "references"
WHERE name = 'MyComponent' AND kind = 'jsx';
```

Filter by `is_write` to find every mutation site:

```sql
SELECT file_path, line_start, column_start FROM "references"
WHERE name = 'count' AND is_write = 1;
```

`is_write` semantics per R.13:

| Source pattern              | Rows emitted               |
| --------------------------- | -------------------------- |
| `x` (read)                  | 1× `is_write=0`            |
| `x = 1` (simple assignment) | 1× `is_write=1` only       |
| `x += 1` (compound)         | 2× — `is_write=0` and `=1` |
| `x++` / `delete x`          | 2× — `is_write=0` and `=1` |
| `const x = 1` (init)        | 1× `is_write=1` only       |

For app-wide rename: every row's `(file_path, line_start, column_start, column_end)` is a TextEdit-ready coordinate. Pair with `find-symbol-definitions` to anchor the rename.

This recipe is name-keyed — same-name refs in different scopes / from different imports all match. For bindings-precise resolution (refs that actually point at a specific symbol definition), use `find-symbol-references`.
