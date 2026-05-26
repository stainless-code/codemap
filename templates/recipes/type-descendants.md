---
params:
  - name: symbol_name
    type: string
    required: true
    description: Base class or interface name to walk downward from.
  - name: kind
    type: string
    required: false
    description: Optional `symbols.kind` filter on **descendant output rows** (`class`, `interface`, or `type`).
  - name: max_depth
    type: number
    required: false
    default: 10
    description: Maximum transitive `extends` hops (cycle-safe). Direct `implements` edges stay depth 1.
  - name: file_path
    type: string
    required: false
    description: Optional project-relative path — disambiguates the base symbol **and** limits output to descendants in that file (see asymmetry note below).
actions:
  - type: trace-type-descendants
    description: "Heritage rows — pair with `codemap show` on `descendant_name` + `descendant_file_path`."
---

# type-descendants

Symbols that **`extends`** or **`implements`** the given type, with transitive **`extends`** descent scoped by resolved **`base_file_path`** / **`base_symbol_id`**.

Heritage edges come from **`type_heritage`**. Recursive walks follow `(descendant_name, descendant_file_path)`. Rows with `resolution_kind` of `qualified-unresolved` or `unresolved` are omitted from walks (including non-simple expressions marked with `base_qualified_name = '(expression)'`).

**`file_path` asymmetry vs `type-ancestors`:** here `file_path` disambiguates the **base** symbol **and** filters **output** to descendants defined in that file. On `type-ancestors`, `file_path` only picks the start symbol and does not filter ancestor output.

**Gaps:** same as [`type-ancestors`](./type-ancestors.md) for unresolved edges.

```bash
codemap query --recipe type-descendants --params symbol_name=Animal
codemap query --recipe type-descendants --params symbol_name=Pet,kind=class
codemap query --recipe type-descendants --params symbol_name=Animal,max_depth=1
codemap query --recipe type-descendants --params symbol_name=Animal,file_path=src/types/hierarchy.ts
```

Returns `depth`, `descendant_name`, `descendant_kind`, `descendant_file_path`, `descendant_line_start`, `relation` (`extends` | `implements`).
