---
params:
  - name: in_file
    type: string
    required: false
    description: Optional file_path prefix filter.
  - name: include_type_only
    type: boolean
    required: false
    default: false
    description: When true, include unused `import type { … }` specifiers.
actions:
  - type: remove-stale-import
    auto_fixable: false
    description: Remove sole-specifier import lines with no in-file references (review before apply).
    command: codemap apply stale-imports --force --yes
---

# stale-imports

Diff-shape rows for **unused import specifiers** — structural dead-import candidates from `import_specifiers` × `"references"`, not a formatter.

```bash
codemap query --recipe stale-imports --format diff-json
codemap apply stale-imports --dry-run
codemap apply stale-imports --force --yes
```

## v1 apply scope

- **Sole specifier per `import_id`** only — one row deletes the whole import line via constructed `before_pattern` + empty `after_pattern`.
- **Does not** remove one name from multi-specifier `import { a, b, c }` lines (use ESLint/Biome/organize-imports for that).
- **Quote style:** patterns assume double-quoted module specifiers (`from "…"`). Single-quoted sources may conflict at apply time.

## Detection (conservative)

- No `"references"` row in the same file with `name = local_name` on a line other than the import line.
- Excludes specifiers whose `local_name` appears in `exports` on the same file (re-export surface).
- Skips `side-effect` and `namespace` kinds.

## False positives (review required)

- Value used only via `import()` dynamic load, globals, or stringly dispatch — not in the references table.
- Specifier kept for side effects on the imported module (prefer `find-side-effect-imports`).
- Type-only imports omitted by default; enable `include_type_only=true` when auditing types.

`auto_fixable: false` — always preview with `--format diff-json` or `--dry-run` before `--force`.
