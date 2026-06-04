---
params:
  - name: component_name
    type: string
    required: true
    description: JSX component or HTML tag name (`ProductCard`, `article`, …).
actions:
  - type: navigate-to-jsx-usages
    description: Each row is one JSX element occurrence with line/column bounds.
  - type: apply-rename-preview
    description: "Component tag rename — uses `component_name` as `old`; replace NEW before apply (includes member/namespaced JSX)."
    command: codemap apply rename-preview --params old={{component_name}},new=NEW --dry-run
  - type: apply-migrate-jsx-prop
    description: "Attribute rename on matching elements — replace OLD_ATTR/NEW_ATTR; `component_name` binds from query param."
    command: codemap apply migrate-jsx-prop --params old_name=OLD_ATTR,new_name=NEW_ATTR,component_name={{component_name}} --dry-run --force
---

# find-jsx-usages

JSX element rows from the `jsx_elements` substrate (Tier 3).

```bash
codemap query --recipe find-jsx-usages --params component_name=article
```

Join `jsx_attributes` on `element_id` for attribute-level queries.

Apply path: `actions[].command` on `--json` rows (or [`migrate-jsx-prop`](./migrate-jsx-prop.md) / [`rename-preview`](./rename-preview.md) directly).
