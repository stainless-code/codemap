---
actions:
  - type: review-import-cycle
    auto_fixable: false
    description: "Strongly-connected components in the import dependency graph. Files sharing `cycle_id` import each other directly or transitively. Each cycle is a candidate for breaking by extracting shared types/utils to a leaf module."
---

# circular-imports

Every file participating in an import cycle, grouped by `cycle_id`. Non-cyclic files don't appear.

```bash
codemap query --recipe circular-imports
```

Cycle detection uses Tarjan's strongly-connected components on the `dependencies` table. A cycle is any SCC of size ≥ 2, plus size-1 SCCs with a self-edge (rare).

To see one specific cycle:

```sql
SELECT file_path FROM module_cycles WHERE cycle_id = 1;
```

To rank cycles by size:

```sql
SELECT cycle_id, cycle_size, COUNT(*) AS n
FROM module_cycles GROUP BY cycle_id ORDER BY cycle_size DESC;
```

Note: the dependency edges come from `imports.resolved_path` — only edges between INDEXED files are considered. External (`react`, `lodash`) imports never form a cycle since they're not indexed.
