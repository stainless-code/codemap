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

- Re-export chains (`export { foo } from './bar'` rebinds `foo`) aren't walked — refs going through a re-export resolve to the re-export's local binding, not the original. Use `find-references` to catch those too.
- Refs to external modules (`react`, `lodash`, etc.) have `resolved_symbol_id=NULL` because their definitions aren't indexed. Use `find-references` for those.
- Targeted reindex skips bindings refresh. Run `bun src/index.ts --full` after editing source if you need fresh bindings.
