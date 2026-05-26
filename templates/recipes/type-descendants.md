---
params:
  - name: symbol_name
    type: string
    required: true
    description: Base class or interface name to walk downward from.
  - name: kind
    type: string
    required: false
    description: Optional `symbols.kind` filter on descendant rows (`class` or `interface`).
  - name: max_depth
    type: number
    required: false
    default: 10
    description: Maximum transitive `extends` hops (cycle-safe). Direct `implements` edges stay depth 1.
actions:
  - type: trace-type-descendants
    description: "Heritage rows — pair with `codemap show` on `descendant_name` + `descendant_file_path`."
---

# type-descendants

Symbols that **`extends`** or **`implements`** the given type, with transitive **`extends`** descent.

Heritage is parsed from indexed `symbols.signature`. Generic arguments are stripped for matching. Homonyms return one row per matching definition.

**Limits:** same signature-parsing caveats as [`type-ancestors`](./type-ancestors.md).

```bash
codemap query --recipe type-descendants --params symbol_name=Animal
codemap query --recipe type-descendants --params symbol_name=Pet,kind=class
```

Returns `depth`, `descendant_name`, `descendant_kind`, `descendant_file_path`, `descendant_line_start`, `relation` (`extends` | `implements`).
