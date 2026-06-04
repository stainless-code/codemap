---
params:
  - name: name
    type: string
    required: true
    description: Symbol name (function) to mark deprecated.
  - name: replacement
    type: string
    required: true
    description: Suggested replacement named in the JSDoc line.
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix filter.
actions:
  - type: add-jsdoc-deprecated
    auto_fixable: false
    description: Insert a @deprecated JSDoc line above an export function definition.
    command: codemap apply add-jsdoc-deprecated --params name={{name}},replacement={{replacement}} --dry-run --force
---

# add-jsdoc-deprecated

Prepends a one-line `@deprecated` JSDoc comment above `export function <name>` definitions.

Pair with `rename-preview` when renaming the symbol body.
