---
params:
  - name: changed_files
    type: string
    required: true
    description: Project-relative changed paths joined with ASCII RS (char 30); built by `codemap affected`.
  - name: test_glob
    type: string
    required: false
    description: Optional SQLite GLOB on files.path (in addition to test_suites and default test suffixes).
  - name: max_depth
    type: number
    required: false
    default: 50
    description: Maximum reverse-dependency hops from each changed file.
actions:
  - type: run-affected-tests
    description: "Test file paths only — CI composes the exit policy and runner command."
---

# affected-tests

Reverse BFS on `dependencies` from changed source files → test files that transitively import them (or match test detection).

**Test detection:** indexed `test_suites.file_path`, default `*.test.*` / `*.spec.*` suffix globs, or optional `test_glob` (SQLite `GLOB`, `*` matches `/`).

**Not a verdict** — output is file paths + hop depth; CI decides whether to run, skip, or fail.

```bash
codemap affected --json
git diff --name-only origin/main | codemap affected --stdin --json
codemap query --recipe affected-tests --params changed_files=src/lib/complexity-fixture.ts --json
```

Each row: `test_path`, `impact_depth` (0 = the test file itself changed).
