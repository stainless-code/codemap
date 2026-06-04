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
    description: Remove unused import specifiers (whole line or one name from a multi-specifier line).
    command: codemap apply stale-imports --params in_file={{in_file}},include_type_only={{include_type_only}} --dry-run --force
---

# stale-imports

Diff-shape rows for **unused import specifiers** — structural dead-import candidates from `import_specifiers` × `"references"`, not a formatter.

```bash
codemap query --recipe stale-imports --format diff-json
codemap apply stale-imports --dry-run
codemap apply stale-imports --force --yes
```

## Apply scope

- **Sole specifier per `import_id`** — deletes the whole import line via constructed `import { … } from "…"` pattern + empty `after_pattern`.
- **Multi-specifier lines** — one row per unused name: first specifier `name, `; later specifiers `, name` (includes `type Name` when `include_type_only=true`).
- **Aliases** — patterns use `imported as local` when they differ.
- **Quote style:** whole-line delete assumes double-quoted module specifiers (`from "…"`). Comma-strip rows match indexed source text only.

## Detection (conservative)

- `sib_count` / `rn` use **all** specifiers on `import_id`, not only unused rows (so a lone dead name on a multi-import line gets `, name` not a whole-line delete).
- No `"references"` row in the same file with `name = local_name` on a line other than the import line.
- Excludes specifiers whose `local_name` appears in `exports` on the same file (re-export surface).
- Skips `side-effect` and `namespace` kinds.

## False positives (review required)

- Value used only via `import()` dynamic load, globals, or stringly dispatch — not in the references table.
- Specifier kept for side effects on the imported module (prefer `find-side-effect-imports`).
- Type-only imports omitted by default; enable `include_type_only=true` when auditing types.

`auto_fixable: false` — always preview with `--format diff-json` or `--dry-run` before `--force`.
