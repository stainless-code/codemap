---
params:
  - name: symbol
    type: string
    required: true
    description: Deprecated callee / import specifier name to rewrite.
  - name: replacement
    type: string
    required: true
    description: Replacement identifier text at call/import sites (e.g. Date.now).
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix filter on output rows.
  - name: require_deprecated
    type: boolean
    required: false
    default: true
    description: When true (default), only run when the symbol has @deprecated in doc_comment.
actions:
  - type: migrate-deprecated
    auto_fixable: false
    description: Rewrite call sites and direct import specifiers away from a deprecated symbol.
    command: codemap apply migrate-deprecated --params symbol={{symbol}},replacement={{replacement}} --dry-run --force
---

# migrate-deprecated

Diff-shape rows to **migrate usages** of a deprecated symbol to a replacement identifier. Pairs with read-only [`deprecated-symbols`](./deprecated-symbols.sql) for discovery.

```bash
codemap query --recipe deprecated-symbols --format diff-json
codemap query --recipe migrate-deprecated --params symbol=now,replacement=Date.now --format diff-json
codemap query --recipe migrate-deprecated --params symbol=now,replacement=Date.now,in_file=src/utils --format diff-json
codemap apply migrate-deprecated --params symbol=now,replacement=Date.now --dry-run
codemap apply migrate-deprecated --params symbol=now,replacement=Date.now,require_deprecated=false --dry-run --force
```

## v1 scope

- **Call sites** — `calls` where `callee_name = symbol` (`provenance` ast-only).
- **Direct imports** — simple binding renames only (`replacement` must be a single identifier — no `.`); member-style replacements (`Date.now`) emit **call_site** rows only.
- Does not rewrite barrel-only consumers (use `rename-preview` `barrel_import_rows`) or JSDoc text (use `deprecated-usages`).

## Caveats

- Substring replace on the line (same as `rename-preview`) — ambiguous when `symbol` appears twice on one line.
- `replacement` is identifier text, not a full expression rewrite — pass `Date.now` for `now()` call sites.
- Set `require_deprecated=false` only when intentionally migrating a symbol not yet tagged `@deprecated`.
