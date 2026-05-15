---
"@stainless-code/codemap": patch
---

Two skill / docs clarifications that ship in the live-served skill (`codemap skill` / `codemap://skill` / `GET /resources/<encoded-skill-uri>`):

- **`parent_name` vs `scope_local_id`** ([#86](https://github.com/stainless-code/codemap/pull/86)). `parent_name` is the nearest _named_ enclosing scope — it walks past anonymous arrows / IIFEs / callbacks, so `parent_name IS NULL` matches **both** true module-scope symbols and symbols inside top-level anonymous IIFEs. For a strict "module-scope only" filter use `scope_local_id = 0`. `docs/architecture.md` `symbols.parent_name` column doc + `40-query-patterns.md` mutability example updated accordingly.

- **`imports.source` vs `imports.resolved_path`** ([#87](https://github.com/stainless-code/codemap/pull/87)). The single most common cause of empty `imports` result sets on alias-using codebases (TS `paths`, Webpack / Vite aliases, Node subpath imports `#internal/…`, monorepo workspaces) is picking the wrong column. The skill now explicitly teaches: filter `source` for "via alias / package name", filter `resolved_path` for "via on-disk path", and `WHERE resolved_path IS NULL` for "external packages only".

No schema change, no CLI / API change. Patch bump; existing `.codemap/index.db` unaffected.
