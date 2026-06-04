---
params:
  - name: old_name
    type: string
    required: true
    description: JSX attribute name to replace (e.g. `data-id`).
  - name: new_name
    type: string
    required: true
    description: New attribute name.
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix filter.
  - name: component_name
    type: string
    required: false
    description: Optional `jsx_elements.component_name` filter (e.g. `article`).
actions:
  - type: migrate-jsx-prop
    auto_fixable: false
    description: Rename JSX attribute names on indexed opening tags (review before apply).
    command: codemap apply migrate-jsx-prop --params old_name={{old_name}},new_name={{new_name}},component_name={{component_name}},in_file={{in_file}} --dry-run --force
---

# migrate-jsx-prop

Diff-shape rows from `jsx_attributes` × `jsx_elements` for **attribute name** renames.

```bash
codemap query --recipe migrate-jsx-prop --params old_name=data-id,new_name=data-testid --format diff-json
codemap apply migrate-jsx-prop --params old_name=data-id,new_name=data-testid --dry-run
```

## Apply patterns

- `expression` / `string` values — `name=` / `new_name=` (avoids bare `id`-style collisions).
- `boolean` shorthand — leading-space ` name` token.
- Skips spread pseudo-attributes (`…spread`).

Pair read-only discovery with `find-jsx-usages` + `jsx_attributes` SQL. Does not rewrite attribute values or string literals inside expressions.

`auto_fixable: false` — preview before `--force`.
