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
  - name: define_in
    type: string
    required: false
    description: When set, anchor `target_symbols` to the definition file (exact `symbols.file_path`). `call_rows` require binding resolution to that symbol — homonym-safe. Distinct from `in_file` (output row prefix only).
actions:
  - type: apply-rename
    auto_fixable: true
    description: Apply rename hunks via codemap apply after reviewing the diff preview.
    command: codemap apply rename-preview --params old={{old}},new={{new}},define_in={{define_in}} --yes
---

# Rename preview

Read-only diff preview for symbol renames (definitions, imports, call sites, binding references, barrel consumer imports, optional re-exports).

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
- Barrel **consumer** import specifiers (`barrel_import_rows`) when `resolved_path` is the barrel file and `re_export_chains` links the specifier to the target symbol.
- Binding-resolved identifier sites (`reference_rows`) from `bindings` × `references`, excluding definition spans and AST call lines already in other CTEs.
- JSX opening tags from `jsx_elements` (`jsx_element_rows`) when no `references.kind='jsx'` row exists on that line (member/namespaced tags like `UI.Panel`).
- JSX closing tags on `line_end` (`jsx_closing_rows`) when no binding-resolved `jsx` reference exists on that line.

## What v1 does not cover

- String literals, comments, dynamic dispatch (`obj[name]`), template-literal property access.
- JSX attribute renames (use `migrate-jsx-prop`).
- Default-import binding shapes beyond direct named specifiers.
- Multi-hop barrel chains beyond `re_export_chains` materialisation.
- Same-line ambiguity when `before_pattern` appears twice on one line (first match only).

Use `rg oldName` for literals/comments. Pair with `find-symbol-references` for audit-only views of binding sites.

**Homonyms:** pass `define_in=src/path/to/definition.ts` (same anchor as `find-symbol-references` definition `file_path`) so only that symbol's definitions, imports, and binding-resolved call sites appear — bare `old`/`new` still unions every homonym in the index.
