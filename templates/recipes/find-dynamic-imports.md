---
params: []
actions:
  - type: navigate-to-reference
    description: "Each row is a dynamic `import()` site with specifier kind and async-fn context."
---

# find-dynamic-imports

List every dynamic `import()` in the indexed project. Tier 6 substrate — literal specifiers get `resolved_path` when oxc-resolver can resolve them.

```bash
codemap query --recipe find-dynamic-imports
```

Filter to lazy imports outside async functions:

```bash
codemap query --json "SELECT * FROM dynamic_imports WHERE source_kind = 'literal' AND in_async_fn = 0"
```
