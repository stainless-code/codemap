---
params:
  - name: old
    type: string
    required: true
    description: The symbol name being renamed.
  - name: new
    type: string
    required: true
    description: The new symbol name.
  - name: kind
    type: string
    required: false
    description: Optional symbols.kind filter.
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix that narrows OUTPUT rows. Definition rows are kept when the defining file is under the prefix; import rows are kept when the importing file is under the prefix. The target symbol may live outside the prefix.
  - name: include_tests
    type: boolean
    required: false
    default: true
    description: Include test / spec files in the preview.
  - name: include_re_exports
    type: boolean
    required: false
    default: true
    description: Reserved for alias-chain support once export locations are indexed.
actions:
  - type: apply-rename
    auto_fixable: true
    description: Apply rename hunks via codemap apply after reviewing the diff preview.
    command: codemap apply rename-preview --params old={{old}},new={{new}} --yes
---

# Rename preview

Read-only diff preview for direct symbol definitions and direct import specifiers.

```bash
codemap query --recipe rename-preview \
  --params old=usePermissions,new=useAccess,kind=function \
  --format diff
```

## What v1 covers

- Definition lines from `symbols`.
- Direct named import specifiers from `imports.specifiers` when `imports.resolved_path` points at the target symbol file.

## What v1 does not cover

- String literals, comments, dynamic dispatch (`obj[name]`), template-literal property access.
- JSX component tag renames (use dedicated JSX recipes).
- Default-import binding shapes beyond direct named specifiers.
- Same-line ambiguity when `before_pattern` appears twice on one line (first match only).

Use `rg oldName` for literals/comments. `include_re_exports` controls single-hop `re_export_chains` rows.
