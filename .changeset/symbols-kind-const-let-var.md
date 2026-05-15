---
"@stainless-code/codemap": minor
---

`symbols.kind` distinguishes `const` / `let` / `var` instead of collapsing all three into `'const'`. Schema bump `SCHEMA_VERSION` 26 → 27 — first run after upgrade auto-rebuilds `.codemap/index.db` via the existing version-mismatch path; consumer queries see the new values immediately.

**What changes:**

- `let x = 1` now emits `kind = 'let'` + `signature = 'let x'`.
- `var y = 2` now emits `kind = 'var'` + `signature = 'var y'`.
- `const z = 3` unchanged (`kind = 'const'` + `signature = 'const z'`).
- Destructuring patterns inherit the declaration keyword: `let { a, b } = obj` → both `a` and `b` are `kind = 'let'`.
- `for (let x of arr) { ... }` body bindings inherit the keyword (`kind = 'let'`).
- Arrow / function init still wins over the keyword: `const handler = () => 1` and `let handler = () => 1` both emit `kind = 'function'`.

**Breaking — but pre-v1 the breakage IS the fix.** Any query that filtered `WHERE kind = 'const'` to mean "all variable bindings" was silently over-matching every `let` and `var`. Post-upgrade the filter is precise; queries that wanted the over-match should widen to `WHERE kind IN ('const', 'let', 'var')`. Affected paths in this PR: the `40-query-patterns.md` const-values example (now demonstrates the precise filter + adds two new patterns that depend on it — "lets that should be const" and "consts that get illegally written"), and `find-write-sites.md` prose where the recipe's documented JOIN trick now works as described.

Mutability filters that finally work:

```sql
-- bindings declared `let` but never reassigned — candidates to tighten to `const`
SELECT s.name, s.file_path, s.line_start FROM symbols s
WHERE s.kind = 'let'
  AND NOT EXISTS (
    SELECT 1 FROM "references" r
    WHERE r.name = s.name
      AND r.file_path = s.file_path
      AND r.is_write = 1
      AND r.line_start > s.line_start
  );

-- `const`s that get reassigned anyway (TypeScript usually catches it; queryable here for completeness)
SELECT s.name, s.file_path, s.line_start FROM symbols s
JOIN "references" r ON r.name = s.name AND r.file_path = s.file_path
WHERE s.kind = 'const' AND r.is_write = 1 AND r.line_start > s.line_start;
```

`find-symbol-by-kind` recipe params updated to enumerate the new values explicitly.
