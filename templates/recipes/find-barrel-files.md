---
params: []
actions:
  - type: navigate-to-definition
    description: "Each row is a barrel file (re-exports only, no local value symbols)."
---

# find-barrel-files

List files flagged `is_barrel = 1` — every export is a re-export and the file defines no local value symbols.

```bash
codemap query --recipe find-barrel-files
```
