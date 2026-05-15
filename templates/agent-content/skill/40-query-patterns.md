## Query patterns

### Basic lookups

```sql
-- Find a symbol definition
SELECT name, kind, file_path, line_start, line_end, signature
FROM symbols WHERE name = 'getConfig';

-- Fuzzy symbol search
SELECT name, kind, file_path, line_start
FROM symbols WHERE name LIKE '%Config%' ORDER BY name;

-- All exported symbols from a file
SELECT name, kind, signature
FROM symbols WHERE file_path LIKE '%settings-provider%' AND is_exported = 1;

-- Enum values (what are the valid members of an enum?)
SELECT name, members FROM symbols
WHERE kind = 'enum' AND name = 'TransactionStatus';

-- Interface / type shape (what fields does a type have?)
SELECT name, type, is_optional, is_readonly FROM type_members
WHERE symbol_name = 'UserSession';

-- Deprecated symbols (find @deprecated via JSDoc)
SELECT name, kind, file_path, doc_comment FROM symbols
WHERE doc_comment LIKE '%@deprecated%';

-- Visibility-tagged symbols (parsed JSDoc tag — single column, no regex)
SELECT name, kind, visibility, file_path
FROM symbols WHERE visibility IS NOT NULL ORDER BY visibility, file_path;

-- Just the @beta surface (filter on the parsed tag, not doc_comment LIKE)
SELECT name, kind, file_path FROM symbols WHERE visibility = 'beta';

-- Symbol documentation
SELECT name, signature, doc_comment FROM symbols
WHERE name = 'formatCurrency' AND doc_comment IS NOT NULL;

-- Const values (config flags, magic strings)
-- `kind = 'const'` excludes `let` / `var` (which can be reassigned anyway).
SELECT name, value, file_path FROM symbols
WHERE kind = 'const' AND value IS NOT NULL AND name LIKE '%URL%';

-- Mutable bindings that should probably be `const` (only initialised, never written again).
-- Resolve writes via `bindings` so shadowed same-name declarations in the same file aren't conflated.
SELECT s.name, s.file_path, s.line_start FROM symbols s
WHERE s.kind = 'let'
  AND NOT EXISTS (
    SELECT 1
    FROM bindings b
    JOIN "references" r ON r.id = b.reference_id
    WHERE b.resolved_symbol_id = s.id
      AND r.is_write = 1
      AND r.line_start > s.line_start
  );

-- `const`s that DO get reassigned (illegal — TypeScript usually catches it, but extracted symbols + write-refs make it queryable)
SELECT s.name, s.file_path, s.line_start FROM symbols s
JOIN bindings b ON b.resolved_symbol_id = s.id
JOIN "references" r ON r.id = b.reference_id
WHERE s.kind = 'const' AND r.is_write = 1 AND r.line_start > s.line_start;

-- Class methods (what does class X expose?)
SELECT name, kind, signature FROM symbols
WHERE parent_name = 'UserService' ORDER BY name;

-- Top-level symbols only (skip nested helpers)
SELECT name, kind, signature FROM symbols
WHERE parent_name IS NULL AND file_path LIKE '%utils%';

-- Who calls function X? (fan-in)
SELECT DISTINCT caller_name, file_path FROM calls
WHERE callee_name = 'fetchUser';

-- What does function X call? (fan-out)
SELECT DISTINCT callee_name FROM calls
WHERE caller_name = 'processUser';

-- Most-called functions (hotspots)
SELECT callee_name, COUNT(*) as fan_in FROM calls
GROUP BY callee_name ORDER BY fan_in DESC LIMIT 10;

-- File overview (imports + exports)
SELECT 'import' as dir, source as name, specifiers as detail
FROM imports WHERE file_path LIKE '%OrderRow%'
UNION ALL
SELECT 'export', name, kind FROM exports WHERE file_path LIKE '%OrderRow%';
```

### Dependency analysis

**Use `DISTINCT`** on dependency and import queries — a file importing multiple specifiers from the same module produces duplicate rows.

```sql
-- Who imports a module by its alias? (matches raw import source string)
SELECT DISTINCT file_path FROM imports WHERE source LIKE '~/lib/api%';

-- Direct dependents (who imports this file? uses resolved paths)
SELECT DISTINCT from_path FROM dependencies WHERE to_path LIKE '%format-date%';

-- Direct dependencies (what does this file import?)
SELECT DISTINCT to_path FROM dependencies WHERE from_path LIKE '%OrderRow%';

-- Most-imported files (hotspots)
SELECT to_path, COUNT(*) as importers
FROM dependencies GROUP BY to_path ORDER BY importers DESC LIMIT 15;

-- Most complex files (most dependencies)
SELECT from_path, COUNT(*) as dep_count
FROM dependencies GROUP BY from_path ORDER BY dep_count DESC LIMIT 15;

-- Circular dependencies (1-hop)
SELECT a.from_path, a.to_path
FROM dependencies a
JOIN dependencies b ON a.to_path = b.from_path AND b.to_path = a.from_path;

-- Orphan files (no one imports them, excluding test and story files)
SELECT f.path FROM files f
LEFT JOIN dependencies d ON d.to_path = f.path
WHERE d.from_path IS NULL
  AND f.path NOT LIKE '%.test.%'
  AND f.path NOT LIKE '%.stories.%'
ORDER BY f.path;
```

### Component analysis

```sql
-- Components using a specific hook
SELECT name, file_path, hooks_used
FROM components WHERE hooks_used LIKE '%useTheme%';

-- Components with most hooks (complexity indicator)
-- `json_array_length` requires SQLite JSON1. For a portable ranking, use
-- `codemap query --json --recipe components-by-hooks` (comma-based count on the stored JSON array).
SELECT name, file_path,
  json_array_length(hooks_used) as hook_count
FROM components ORDER BY hook_count DESC LIMIT 15;

-- Components with props types
SELECT name, file_path, props_type
FROM components WHERE props_type IS NOT NULL ORDER BY name;
```

### CSS analysis

```sql
-- All design tokens (color palette)
SELECT name, value, scope FROM css_variables
WHERE name LIKE '--blue%' OR name LIKE '--gray%' ORDER BY name;

-- Tailwind theme tokens
SELECT name, value FROM css_variables WHERE scope = '@theme' LIMIT 20;

-- All CSS module classes in a file
SELECT name FROM css_classes
WHERE file_path LIKE '%ProductCard%' AND is_module = 1;

-- All keyframe animations
SELECT name, file_path FROM css_keyframes;

-- Token categories (grouped by prefix)
SELECT
  substr(name, 1, instr(substr(name, 3), '-') + 2) as prefix,
  COUNT(*) as count
FROM css_variables
GROUP BY prefix ORDER BY count DESC;
```

### Substrate tables (references, params, runtime, tests, cycles, coverage)

```sql
-- Every reference to a name (USE-sites; not just calls)
-- `references` is a reserved word in SQLite — quote it.
SELECT file_path, line_start, column_start, kind, is_write
FROM "references" WHERE name = 'fetchUser';

-- Only the write-sites of a name (assignment / update / declaration-with-init)
SELECT file_path, line_start FROM "references"
WHERE name = 'currentUser' AND is_write = 1;

-- The symbol a reference resolves to (bindings join)
SELECT s.name, s.file_path, s.line_start
FROM "references" r
JOIN bindings b ON b.reference_id = r.id
JOIN symbols s ON s.id = b.resolved_symbol_id
WHERE r.name = 'fetchUser';

-- Functions taking a parameter of a specific type
SELECT owner_name, owner_kind, file_path, line_start
FROM function_params WHERE type_text = 'User' ORDER BY file_path, line_start;

-- Functions with a rest parameter
SELECT owner_name, name, file_path FROM function_params
WHERE is_rest = 1 ORDER BY file_path;

-- Leftover console.* calls
SELECT file_path, line_start, detail FROM runtime_markers
WHERE kind = 'console' ORDER BY file_path, line_start;

-- Env vars referenced anywhere (process.env.X)
SELECT detail AS env_var, COUNT(*) AS uses
FROM runtime_markers WHERE kind = 'process-env'
GROUP BY detail ORDER BY uses DESC;

-- Skipped / only / todo tests (any modifier)
SELECT file_path, name, kind, framework FROM test_suites
WHERE is_skipped = 1 OR is_only = 1 OR is_todo = 1;

-- Files participating in an import cycle
SELECT cycle_id, file_path FROM module_cycles ORDER BY cycle_id, file_path;

-- Re-export chains longer than one hop (barrel files)
SELECT from_file, from_name, to_file, to_name, hops
FROM re_export_chains WHERE hops >= 2 ORDER BY hops DESC;

-- Coverage of every measured symbol in a file
SELECT name, hit_statements, total_statements, coverage_pct
FROM coverage WHERE file_path = 'src/foo.ts'
ORDER BY coverage_pct ASC NULLS LAST;
```

### Efficient pagination (cursor-based)

For large result sets, avoid `OFFSET` — use cursor-based pagination with the last-seen value:

```sql
-- First page
SELECT name, kind, file_path, line_start FROM symbols
WHERE is_exported = 1
ORDER BY name LIMIT 50;

-- Next page (use last name from previous result as cursor)
SELECT name, kind, file_path, line_start FROM symbols
WHERE is_exported = 1 AND name > 'lastSeenName'
ORDER BY name LIMIT 50;
```

### Conditional aggregation (single query for multiple counts)

```sql
-- Instead of multiple COUNT(*) queries, use conditional aggregation:
SELECT
  (SELECT COUNT(*) FROM files) as files,
  (SELECT COUNT(*) FROM symbols) as symbols,
  (SELECT COUNT(*) FROM imports) as imports,
  (SELECT COUNT(*) FROM components) as components,
  (SELECT COUNT(*) FROM dependencies) as dependencies;
```

### Codebase statistics

```sql
-- Files by language
SELECT language, COUNT(*) as count FROM files GROUP BY language;

-- Symbols by kind
SELECT kind, COUNT(*) as count FROM symbols GROUP BY kind ORDER BY count DESC;

-- Exported vs internal symbols
SELECT
  SUM(is_exported) as exported,
  COUNT(*) - SUM(is_exported) as internal
FROM symbols;

-- Largest files
SELECT path, line_count, size FROM files ORDER BY line_count DESC LIMIT 15;

-- All TODO/FIXME markers
SELECT kind, COUNT(*) as count FROM markers GROUP BY kind;
```
