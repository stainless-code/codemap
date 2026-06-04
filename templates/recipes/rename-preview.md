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
    description: When false, omit single-hop re_export_chains rows from the preview.
actions:
  - type: apply-rename
    auto_fixable: true
    description: Apply rename hunks via codemap apply after reviewing the diff preview.
    command: codemap apply rename-preview --params old={{old}},new={{new}} --yes
---

# Rename preview

Read-only diff preview for symbol renames (definitions, imports, call sites, optional re-exports).

```bash
codemap query --recipe rename-preview \
  --params old=usePermissions,new=useAccess,kind=function \
  --format diff
```

## What v1 covers

- Definition lines from `symbols`.
- Direct named import specifiers from `imports.specifiers` when `imports.resolved_path` points at the target symbol file.
- AST call sites from `calls` where `callee_name` matches (`provenance` ast-only).
- Single-hop barrel re-export lines via `re_export_chains` when `include_re_exports` is true (default).

## What v1 does not cover

- String literals, comments, dynamic dispatch (`obj[name]`), template-literal property access.
- JSX component tag renames (use dedicated JSX recipes).
- Default-import binding shapes beyond direct named specifiers.
- Imports through barrel files (consumer imports the barrel, not the defining module).
- Same-line ambiguity when `before_pattern` appears twice on one line (first match only).

Use `rg oldName` for literals/comments. Pair with `find-symbol-references` for binding sites the rename CTEs skip.
