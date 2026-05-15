---
params:
  - name: type_text
    type: string
    required: true
    description: Exact type-annotation string to match (`ClientConfig`, `string`, `User | null`, `Promise<void>`). Case-sensitive.
actions:
  - type: navigate-to-param
    description: "Every function/method/arrow whose parameter has this exact type annotation. Combine with `find-symbol-references` to find callers when refactoring a shared type."
---

# find-by-param-type

Every parameter whose type annotation exactly matches the given string. Powers "find everything that takes a `User`" / "find every fn taking `Promise<...>`" / "find callers of a deprecated type" workflows.

```bash
codemap query --recipe find-by-param-type --params type_text=ClientConfig
codemap query --recipe find-by-param-type --params type_text=string
```

Match is exact-string on the stringified annotation (no structural type comparison). For partial matches (e.g. find anything taking `User` anywhere in the type), use direct SQL with `LIKE`:

```sql
SELECT * FROM function_params WHERE type_text LIKE '%User%';
```

Available filters on `function_params`:

- `owner_kind` — `function` / `method` / `arrow` / `constructor` / `getter` / `setter`
- `is_rest = 1` — `...args` rest params only
- `is_optional = 1` — params with `?` or default value
- `default_text IS NOT NULL` — params that have an inline default

Untyped params (no annotation) have `type_text = NULL` and won't match.
