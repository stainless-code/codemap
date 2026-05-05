---
"@stainless-code/codemap": minor
---

feat(recipes): add read-only `rename-preview` recipe

Adds a conservative `rename-preview` bundled recipe that composes the new parametrised recipe infrastructure with the new diff formatters:

```bash
codemap query --recipe rename-preview \
  --params old=usePermissions,new=useAccess,kind=function \
  --format diff
```

The v1 recipe emits rows shaped for `--format diff` / `diff-json` and covers:

- symbol definition lines from `symbols`
- direct named import specifier lines from `imports.specifiers` when `imports.resolved_path` points at the target symbol file

It intentionally does **not** cover call sites, re-export alias chains, string literals, comments, dynamic dispatch, or template-literal property access yet. Those require more precise source-location substrate (for calls / exports) or non-structural search. The recipe `.md` documents the caveats clearly and repeats the key product-floor rule: codemap never writes files; this is a preview for review / `git apply --check`.

Parameters:

- `old` (required string)
- `new` (required string)
- `kind` (optional string)
- `in_file` (optional string path prefix)
- `include_tests` (optional boolean, default true)
- `include_re_exports` (optional boolean, default true; reserved until export locations are indexed)
