---
params:
  - name: name
    type: string
    required: true
    description: Exact symbol name to locate (case-sensitive; use `find-symbol-by-kind` for `LIKE`-pattern matches).
actions:
  - type: navigate-to-definitions
    description: "Each row carries `file_path:line_start:name_column_start` for IDE / agent jump-to-definition. Column range covers the name token only (per R.6) — drop-in candidate for rename diffs."
  - type: apply-rename-preview
    description: "App-wide rename diff — uses query param `name` as `old`; replace NEW with the new identifier before apply."
    command: codemap apply rename-preview --params old={{name}},new=NEW --dry-run
---

# find-symbol-definitions

Locate every definition of a named symbol with column-precise positions. Foundation for `rename-preview`'s definition-row CTE (Tier 6 will extend to call sites + re-export aliases via [`find-call-sites`](./find-call-sites.md) + [`find-export-sites`](./find-export-sites.md)).

```bash
codemap query --recipe find-symbol-definitions --params name=usePermissions
```

`name_column_start` / `name_column_end` are byte offsets within `line_start` (0-indexed; end is one-past-last per R.6).
