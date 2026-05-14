---
params:
  - name: imported_name
    type: string
    required: true
    description: Name as exported by the source module (the LHS of `as`-aliasing — `foo` in `import { foo as bar }`).
actions:
  - type: navigate-to-import-sites
    description: "Each row carries `file_path:line:column_start` for the local-binding token (the rewrite-relevant token per R.6). For type-only specifiers (`import { type Foo }`) `is_type_only = 1`."
---

# find-import-sites

List every import site of a named binding — across every file that imports it, with column-precise position of the local-binding token. Foundation for specifier-precise import rewrites (rename, dedupe, type-only migration). Complements `find-symbol-definitions` (definition side), `find-export-sites` (export side), `find-call-sites` (use side).

```bash
codemap query --recipe find-import-sites --params imported_name=usePermissions
```

`is_type_only = 1` marks the specifier as type-only (`import type { X }` or `import { type X }`). `kind` distinguishes `named` / `default` / `namespace` (side-effect imports have no specifiers).
