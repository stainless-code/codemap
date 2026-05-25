---
params:
  - name: changed_files
    type: string
    required: true
    description: Project-relative changed paths joined with ASCII RS (char 30); built by `codemap affected`.
  - name: test_glob
    type: string
    required: false
    description: Optional SQLite GLOB on files.path; when set, replaces default suffix globs (test_suites always included).
  - name: max_depth
    type: number
    required: false
    default: 50
    description: Maximum reverse-dependency hops from each changed file (0 = only directly-changed test files).
actions:
  - type: run-affected-tests
    description: "Test file paths only — CI composes the exit policy and runner command."
---

# affected-tests

Reverse BFS on `dependencies` from changed source files → test files that transitively import them (or match test detection).

**Test detection:** always includes indexed `test_suites.file_path`. When `test_glob` is omitted, also matches default `*.test.*` / `*.spec.*` suffix globs (SQLite `GLOB`; `*` matches `/`). When `test_glob` is set, it **replaces** those default suffix globs (not additive). Empty `test_glob=""` disables suffix matching but keeps `test_suites`.

**Depth:** `impact_depth` 0 = the test file itself changed. `max_depth=0` on a non-test source returns `[]`. Expansion runs while `depth < max_depth` (same sentinel as `codemap impact`).

**Not a verdict** — output is file paths + hop depth; CI decides whether to run, skip, or fail.

```bash
codemap affected --json
git diff --name-only origin/main | codemap affected --stdin --json
codemap query --recipe affected-tests --params changed_files=src/lib/complexity-fixture.ts --json
```

Each row: `test_path`, `impact_depth`.
