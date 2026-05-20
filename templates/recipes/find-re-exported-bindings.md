---
params: []
actions:
  - type: navigate-to-reference
    description: "Each row is a binding resolved through a re-export chain (Tier 2.1 / Tier 6)."
---

# find-re-exported-bindings

List identifier references whose binding resolved via a re-export chain (`resolution_kind = 're-exported'`).

```bash
codemap query --recipe find-re-exported-bindings
```
