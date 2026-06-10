---
params:
  - name: min_count
    type: number
    required: false
    default: 2
    description: Minimum symbols sharing the same body_hash to surface (default 2)
  - name: path_prefix
    type: string
    required: false
    default: ""
    description: Optional file_path prefix filter (empty = all indexed paths)
  - name: min_body_lines
    type: number
    required: false
    default: 2
    description: Minimum function span in lines (default 2; excludes one-line arrows and tiny bodies)
actions:
  - type: review-duplicate-bodies
    auto_fixable: false
    description: "Function bodies with identical structural body_hash — rename-insensitive (identifiers and literal values erased). Triage with snippet; extract shared helper when confirmed."
---

# duplicates

Symbols whose **`body_hash`** collides — structurally identical function bodies (top-level `function`, named arrow/const inits, class methods/getters/setters). Distinct from token-level copy-paste / suffix-array duplication engines.

```bash
codemap query --recipe duplicates
codemap query --recipe duplicates --params path_prefix=src/lib/
codemap query --recipe duplicates --params min_body_lines=3
```

False positives are possible when unrelated functions share the same control-flow skeleton, or when sync vs async / generator flags differ but the block body matches — use `codemap snippet` before refactoring. Results cap at 50 rows per query (no truncation marker).
