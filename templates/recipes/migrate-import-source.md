---
params:
  - name: old_source
    type: string
    required: true
    description: Import source path to replace (exact match).
  - name: new_source
    type: string
    required: true
    description: Replacement import source path.
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix filter.
actions:
  - type: migrate-import-source
    auto_fixable: true
    description: Rewrite import source string on the import line.
    command: codemap apply migrate-import-source --params old_source={{old_source}},new_source={{new_source}} --yes
---

# migrate-import-source

Exact-match import `source` path migration (one row per `imports` line).

```bash
codemap apply migrate-import-source --params old_source=~/api/client,new_source=~/api/client-v2 --dry-run
```
