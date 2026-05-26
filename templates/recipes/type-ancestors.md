---
params:
  - name: symbol_name
    type: string
    required: true
    description: Class or interface name to walk upward from.
  - name: kind
    type: string
    required: false
    description: Optional `symbols.kind` filter on the start symbol (`class` or `interface`).
  - name: max_depth
    type: number
    required: false
    default: 10
    description: Maximum `extends` hops (cycle-safe). Direct `implements` edges are always depth 1 only.
actions:
  - type: trace-type-ancestors
    description: "Heritage rows — pair with `codemap show` on `ancestor_name` + `ancestor_file_path`."
---

# type-ancestors

Transitive **`extends`** chain plus direct **`implements`** interfaces for a class or interface.

Heritage is parsed from indexed `symbols.signature` (`extends` / `implements` clauses). Generic arguments are stripped for matching (`Base<T>` → `Base`). Homonyms return one row per matching definition.

**Limits:** heritage is signature-derived, not a dedicated substrate column — qualified extends (`extends pkg.Type`), type-only extends, and commas inside generic args may be missed. See plan [`call-path-type-hierarchy-recipes`](../../docs/plans/call-path-type-hierarchy-recipes.md).

```bash
codemap query --recipe type-ancestors --params symbol_name=Dog
codemap query --recipe type-ancestors --params symbol_name=Dog,kind=class,max_depth=5
```

Returns `depth`, `ancestor_name`, `ancestor_kind`, `ancestor_file_path`, `ancestor_line_start`, `relation` (`extends` | `implements`).
