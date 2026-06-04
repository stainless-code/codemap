---
actions:
  - type: audit-markers
    description: "Counts by marker kind — pair with per-file queries or [`markers-by-kind`](./markers-by-kind.sql) filters."
  - type: apply-replace-marker-kind
    description: "Bulk rewrite one marker kind to another — replace FROM_KIND and TO_KIND (e.g. TODO → FIXME) before apply."
    command: codemap apply replace-marker-kind --params from_kind=FROM_KIND,to_kind=TO_KIND --dry-run
---

# markers-by-kind

Marker counts by kind (TODO, FIXME, …). For disk apply after scoping kinds, use [`replace-marker-kind`](./replace-marker-kind.md).
