---
params:
  - name: symbol
    type: string
    required: true
    description: Symbol whose leading @deprecated JSDoc line to rewrite.
  - name: replacement_message
    type: string
    required: true
    description: New prose after `@deprecated` on that line (no tag prefix).
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix filter.
actions:
  - type: update-deprecated-jsdoc
    auto_fixable: false
    description: Rewrite the first @deprecated JSDoc line on the symbol definition.
    command: codemap apply deprecated-usages --params symbol={{symbol}},replacement_message={{replacement_message}} --force --yes
---

# deprecated-usages

Updates the **first line** of the `@deprecated` block comment on a symbol definition (documentation sync). Does not change call sites — use [`migrate-deprecated`](./migrate-deprecated.md) for usages.

```bash
codemap apply deprecated-usages --params symbol=now,replacement_message="Use Date.now() only." --dry-run
```

## Line anchor

Computes the file line from `symbols.line_start` and newline offsets inside `doc_comment` (block comment immediately above the definition). Fails apply if the on-disk comment drifted from indexed `doc_comment`.

## Pairing

1. `deprecated-symbols` — list tagged symbols.
2. `deprecated-usages` — align JSDoc guidance (optional).
3. `migrate-deprecated` — rewrite call/import sites.
