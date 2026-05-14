---
params:
  - name: name
    type: string
    required: true
    description: Exported name (exact match — `default` for default exports, the local-aliased name for `export { x as y }`).
actions:
  - type: navigate-to-export-sites
    description: "Each row carries `file_path:line_start:column_start` (callee-token-precise per R.6) plus `is_re_export` so consumers can branch on direct-export vs alias-chain shape."
---

# find-export-sites

List every export site of a named binding — both direct exports and re-exports (`export { x } from 'mod'`). Column-precise per R.6. Foundation for app-wide rename recipe extension covering re-export alias chains.

```bash
codemap query --recipe find-export-sites --params name=ProductCard
```

`is_re_export = 1` rows carry `re_export_source` (the `from` module); `is_re_export = 0` rows are direct exports where the name binds locally.
