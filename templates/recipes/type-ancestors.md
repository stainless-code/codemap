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
  - name: file_path
    type: string
    required: false
    description: Optional project-relative path to disambiguate homonymous start symbols (`src/types/hierarchy.ts`).
actions:
  - type: trace-type-ancestors
    description: "Heritage rows — pair with `codemap show` on `ancestor_name` + `ancestor_file_path`."
---

# type-ancestors

Transitive **`extends`** chain plus direct **`implements`** interfaces for a class or interface.

Heritage edges come from the indexed **`type_heritage`** table (AST extraction + import-aware resolve pass). Generic type arguments are stored in `type_args` but graph walks use `base_simple_name`. Rows with `resolution_kind` of `qualified-unresolved` or `unresolved` are omitted from walks.

**Gaps:** qualified namespace extends (`pkg.Type`) stay unresolved until a namespace map exists. Direct `implements` edges are depth 1 only (not transitive).

```bash
codemap query --recipe type-ancestors --params symbol_name=Dog
codemap query --recipe type-ancestors --params symbol_name=Dog,kind=class,max_depth=1
codemap query --recipe type-ancestors --params symbol_name=Dog,file_path=src/types/hierarchy.ts
```

Returns `depth`, `ancestor_name`, `ancestor_kind`, `ancestor_file_path`, `ancestor_line_start`, `relation` (`extends` | `implements`).
