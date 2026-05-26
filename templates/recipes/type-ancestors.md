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

Heritage is parsed from indexed `symbols.signature` (`extends` / `implements` clauses). Generic arguments are stripped for matching (`Base<T>` → `Base`). Unqualified base names resolve with **same-file preference** (parent type in the child's file wins over a homonym elsewhere). Multiple definitions can still appear when the index cannot disambiguate further — same pattern as [`symbol-neighborhood`](./symbol-neighborhood.md) homonyms.

**Limits (signature-derived, no dedicated heritage column):**

- Qualified extends (`extends pkg.Type`) and cross-module unqualified extends may miss or fan out.
- Multi-base `extends A, B` splits on `', '` only — commas inside generic args can mis-split.
- `extends A,B` without a space after the comma is not split.
- Direct `implements` edges are depth 1 only (not transitive).

```bash
codemap query --recipe type-ancestors --params symbol_name=Dog
codemap query --recipe type-ancestors --params symbol_name=Dog,kind=class,max_depth=1
codemap query --recipe type-ancestors --params symbol_name=Dog,file_path=src/types/hierarchy.ts
```

Returns `depth`, `ancestor_name`, `ancestor_kind`, `ancestor_file_path`, `ancestor_line_start`, `relation` (`extends` | `implements`).
