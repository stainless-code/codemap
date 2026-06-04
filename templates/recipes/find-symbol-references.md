---
params:
  - name: name
    type: string
    required: true
    description: Symbol name to find references for (`extractFileData`, `useState`, `MyComponent`).
  - name: file_path
    type: string
    required: true
    description: Project-relative file path of the symbol DEFINITION (`src/parser.ts`, `src/components/Button.tsx`).
actions:
  - type: navigate-to-reference
    description: "Bindings-precise per R.12 — every row's `resolved_symbol_id` matches the named symbol at the given file (not just same-name elsewhere). Pair with `find-symbol-definitions` to anchor a rename across an entire app. Drops same-name refs that shadow in inner scopes or come from different imports."
  - type: apply-rename-preview
    description: "App-wide rename diff — uses query param `name` as `old`; replace NEW with the new identifier before apply."
    command: codemap apply rename-preview --params old={{name}},new=NEW,define_in={{file_path}} --dry-run
---

# find-symbol-references

Every reference that resolves to a specific symbol — name + definition file. Unlike `find-references` (which is name-keyed), this is **bindings-precise**: same-name shadows and different-source imports are filtered out.

```bash
codemap query --recipe find-symbol-references \
  --params name=extractFileData,file_path=src/parser.ts
```

Workflow for app-wide rename:

1. `find-symbol-definitions --params name=Foo` → pick the definition file.
2. `find-symbol-references --params name=Foo,file_path=<that file>` → every use to rewrite.
3. Combine `(file_path, line_start, column_start, column_end)` from both into TextEdit coordinates.

Limitations:

- Refs to external modules (`react`, `lodash`, etc.) have `resolved_symbol_id=NULL` — their definitions aren't indexed. Use `find-references` for those.
- Targeted reindex skips bindings refresh. Run `codemap --full` after editing source if you need fresh bindings.

Re-export chains (`export { foo } from './bar'`) ARE walked — refs through a barrel file resolve to the original symbol, bounded at 10 hops to break circulars.
