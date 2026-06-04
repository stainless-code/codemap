---
params:
  - name: from_kind
    type: string
    required: true
    description: Marker kind to replace (e.g. TODO).
  - name: to_kind
    type: string
    required: true
    description: New marker kind (e.g. FIXME).
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix filter.
actions:
  - type: replace-marker-kind
    auto_fixable: true
    description: Replace marker kind token in marker line content.
    command: codemap apply replace-marker-kind --params from_kind={{from_kind}},to_kind={{to_kind}},in_file={{in_file}} --yes
---

# replace-marker-kind

Rewrites marker line content by replacing one kind token with another (e.g. `TODO` → `FIXME`).

```bash
codemap query --recipe replace-marker-kind --params from_kind=TODO,to_kind=FIXME --format diff
codemap apply replace-marker-kind --params from_kind=TODO,to_kind=FIXME --yes
```
