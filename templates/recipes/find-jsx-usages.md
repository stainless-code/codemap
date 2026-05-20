---
params:
  - name: component_name
    type: string
    required: true
    description: JSX component or HTML tag name (`ProductCard`, `article`, …).
actions:
  - type: navigate-to-jsx-usages
    description: Each row is one JSX element occurrence with line/column bounds.
---

# find-jsx-usages

JSX element rows from the `jsx_elements` substrate (Tier 3).

```bash
codemap query --recipe find-jsx-usages --params component_name=article
```

Join `jsx_attributes` on `element_id` for attribute-level queries.
