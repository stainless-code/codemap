---
"@stainless-code/codemap": minor
---

feat(recipes): parametrised recipe support + `find-symbol-by-kind`

Recipes may now declare `params` in sibling `<id>.md` frontmatter and consume values through positional `?` placeholders in SQL. Values validate before SQL binding and support `string`, `number`, and `boolean` types.

**CLI**

- `codemap query --recipe <id> --params key=value[,key=value]`
- `--params` may be repeated; duplicate keys use last-write semantics.
- Values may contain `=` (split on first equals). Values containing literal commas should use repeated `--params`.
- Param validation is strict: missing required, unknown, and malformed values return `{error}`.

**MCP / HTTP**

- `query_recipe` accepts `params: {key: value}`.
- HTTP `POST /tool/query_recipe` uses the same shape.

**Catalog**

- `--recipes-json`, `codemap://recipes`, and `codemap://recipes/{id}` expose the `params` declaration for each parametrised recipe.

**Example bundled recipe**

- `find-symbol-by-kind` demonstrates the new path:
  `codemap query --json --recipe find-symbol-by-kind --params kind=function,name_pattern=%Query%`

No schema bump. Runtime remains read-only via `PRAGMA query_only=1`; params are bound through SQLite placeholders, not string interpolation.
