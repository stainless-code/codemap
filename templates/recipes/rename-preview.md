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
    description: Optional file_path prefix to narrow scope.
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
  - type: review-rename
    description: "Read-only preview. Run `git apply --check` before applying; codemap never writes files."
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

- Call sites inside function bodies — the current `calls` table records caller/callee names but not callee source line/column.
- Re-export alias chains — the current `exports` table records names but not export source locations.
- String literals, comments, dynamic dispatch (`obj[name]`), template-literal property access.

Use `rg oldName` separately before applying the diff. This recipe is intentionally conservative; future slices can widen coverage after the substrate records precise source locations for calls and exports.
