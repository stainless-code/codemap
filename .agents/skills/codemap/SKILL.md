# Codemap — full reference

Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding symbols, tracing dependencies, or auditing a project indexed by **Codemap**.

## Bundled content (stay generic)

Examples below use **placeholders** (`'...'`, `getConfig`, `~/lib/api`, etc.) — not a real product tree. **Shipped skill and rules stay generic** so they apply to any repo.

**This repository:** run the CLI with **`bun src/index.ts`** (same as **`bun run dev`**). **Consumer / npm** copy of this skill lives under **`templates/agents/skills/codemap/`** (installed with **`codemap agents init`**). Edit **`.agents/`** here for Codemap development; **do not** treat it as the published package layout.

**Run queries:**

```bash
bun src/index.ts query "<SQL>"
```

After **`bun run build`**, **`node dist/index.mjs query …`** or a linked **`codemap`** binary matches the published CLI. Use **`--root`** / **`CODEMAP_ROOT`** to index another tree.

## Query output and agents

- **`bun src/index.ts query --json`** prints a **JSON array** of row objects to stdout on success.
- **On failure**, stdout is a single object **`{"error":"<message>"}`** and the process exits **1**. This covers **invalid SQL**, **database open errors**, and **`query` bootstrap failures** (config load, resolver setup), not only SQL parse/runtime errors. The CLI sets **`process.exitCode`** instead of calling **`process.exit`**, so piped stdout is not cut off mid-stream.
- The CLI **does not cap** how many rows SQLite returns — add **`LIMIT`** and **`ORDER BY`** in SQL when you need a bounded list.
- When answering with structural facts from the index (lists of paths, symbols, dependency edges), **ground the answer in the query rows** — do not invent or silently drop rows. Prefer **`--json`** for large or multi-column results.

## Agent-friendly SQL recipes

Replace placeholders (`'...'`) with your module path, file glob, or symbol name.

**CLI shortcuts:** **`bun src/index.ts query --recipe <id>`** runs bundled SQL (optional **`--json`**). **`bun src/index.ts query --recipes-json`** prints every bundled recipe (**`id`**, **`description`**, **`sql`**) as JSON (no index / DB required). **`bun src/index.ts query --print-sql <id>`** prints one recipe’s SQL only. Ids include **`fan-out`**, **`fan-out-sample`** (**`GROUP_CONCAT`** samples), **`fan-out-sample-json`** (same, but **`json_group_array`** — needs SQLite JSON1), **`fan-in`**, **`index-summary`**, **`files-largest`**, **`components-by-hooks`**, **`markers-by-kind`** — see **`bun src/index.ts query --help`**.

**Determinism:** Bundled recipes use stable secondary **`ORDER BY`** tie-breakers (and ordered inner **`LIMIT`** samples where applicable). Prefer **`--recipe`** over pasting SQL when you need the maintained ordering. **Canonical SQL** is **`src/cli/query-recipes.ts`** (`QUERY_RECIPES`).

The blocks below match **`fan-out`** and **`fan-out-sample`** in **`QUERY_RECIPES`**; other recipes align with “Conditional aggregation”, “Codebase statistics”, and component sections later in this skill.

**Top files by dependency fan-out** (`fan-out`):

```sql
SELECT from_path, COUNT(*) AS deps
FROM dependencies
GROUP BY from_path
ORDER BY deps DESC, from_path ASC
LIMIT 10
```

**Same ranking, plus up to five sample targets per file** (`fan-out-sample`):

```sql
SELECT d.from_path,
  COUNT(*) AS deps,
  (SELECT GROUP_CONCAT(to_path, ' | ')
   FROM (SELECT to_path FROM dependencies d2 WHERE d2.from_path = d.from_path ORDER BY to_path ASC LIMIT 5))
    AS sample_targets
FROM dependencies d
GROUP BY d.from_path
ORDER BY deps DESC, d.from_path ASC
LIMIT 10
```

**JSON array samples (JSON1):** use **`bun src/index.ts query --recipe fan-out-sample-json`** — or replace **`GROUP_CONCAT`** with **`json_group_array(to_path)`** in the inner subquery if your SQLite build has JSON1.

## Schema

### `files` — Every indexed file

| Column        | Type    | Description                                                                      |
| ------------- | ------- | -------------------------------------------------------------------------------- |
| path          | TEXT PK | Relative path from project root                                                  |
| content_hash  | TEXT    | Wyhash fingerprint (base-36)                                                     |
| size          | INTEGER | File size in bytes                                                               |
| line_count    | INTEGER | Number of lines                                                                  |
| language      | TEXT    | `ts`, `tsx`, `js`, `jsx`, `css`, `md`, `mdx`, `mdc`, `json`, `yaml`, `sh`, `txt` |
| last_modified | INTEGER | Unix timestamp (ms)                                                              |
| indexed_at    | INTEGER | When this file was last indexed                                                  |

### `symbols` — Functions, types, interfaces, enums, constants, classes

| Column            | Type       | Description                                                           |
| ----------------- | ---------- | --------------------------------------------------------------------- |
| id                | INTEGER PK | Auto-increment ID                                                     |
| file_path         | TEXT FK    | References `files(path)`                                              |
| name              | TEXT       | Symbol name                                                           |
| kind              | TEXT       | `function`, `class`, `type`, `interface`, `enum`, `const`, `variable` |
| line_start        | INTEGER    | Start line (1-based)                                                  |
| line_end          | INTEGER    | End line (1-based)                                                    |
| signature         | TEXT       | e.g. `createHandler()`, `type UserProps`                              |
| is_exported       | INTEGER    | 1 if exported                                                         |
| is_default_export | INTEGER    | 1 if default export                                                   |

### `imports` — Import statements

| Column        | Type    | Description                                     |
| ------------- | ------- | ----------------------------------------------- |
| file_path     | TEXT FK | The importing file                              |
| source        | TEXT    | Raw import source (e.g. `~/lib/utils`, `react`) |
| resolved_path | TEXT    | Resolved file path, NULL for external packages  |
| specifiers    | TEXT    | JSON array of imported names                    |
| is_type_only  | INTEGER | 1 if `import type`                              |
| line_number   | INTEGER | Line of the import statement                    |

### `exports` — Export manifest

| Column           | Type    | Description                                   |
| ---------------- | ------- | --------------------------------------------- |
| file_path        | TEXT FK | The exporting file                            |
| name             | TEXT    | Exported name (`default` for default exports) |
| kind             | TEXT    | `value`, `type`, `re-export`                  |
| is_default       | INTEGER | 1 if default export                           |
| re_export_source | TEXT    | Source module for re-exports                  |

### `components` — React components (TSX files)

| Column            | Type    | Description                                                  |
| ----------------- | ------- | ------------------------------------------------------------ |
| file_path         | TEXT FK | Component file                                               |
| name              | TEXT    | Component name (PascalCase)                                  |
| props_type        | TEXT    | Props type/interface name, if detected                       |
| hooks_used        | TEXT    | JSON array of hooks called (e.g. `["useState", "useQuery"]`) |
| is_default_export | INTEGER | 1 if default export                                          |

### `dependencies` — File-to-file dependency graph

| Column    | Type    | Description             |
| --------- | ------- | ----------------------- |
| from_path | TEXT FK | The file that imports   |
| to_path   | TEXT    | The file being imported |

### `markers` — TODO/FIXME/HACK/NOTE comments

| Column      | Type    | Description                     |
| ----------- | ------- | ------------------------------- |
| file_path   | TEXT FK | File containing the marker      |
| line_number | INTEGER | Line number (1-based)           |
| kind        | TEXT    | `TODO`, `FIXME`, `HACK`, `NOTE` |
| content     | TEXT    | The marker text                 |

### `css_variables` — CSS custom properties (design tokens)

| Column      | Type    | Description                                         |
| ----------- | ------- | --------------------------------------------------- |
| file_path   | TEXT FK | CSS file containing the variable                    |
| name        | TEXT    | Variable name (e.g. `--blue-50`, `--text-h1`)       |
| value       | TEXT    | Parsed value (e.g. `rgb(215, 225, 242)`, `3rem`)    |
| scope       | TEXT    | Where defined: `:root`, `@theme`, or selector scope |
| line_number | INTEGER | Line number (1-based)                               |

### `css_classes` — CSS class definitions

| Column      | Type    | Description                     |
| ----------- | ------- | ------------------------------- |
| file_path   | TEXT FK | CSS file containing the class   |
| name        | TEXT    | Class name (without `.` prefix) |
| is_module   | INTEGER | 1 if from a `.module.css` file  |
| line_number | INTEGER | Line number (1-based)           |

### `css_keyframes` — @keyframes animation definitions

| Column      | Type    | Description                       |
| ----------- | ------- | --------------------------------- |
| file_path   | TEXT FK | CSS file containing the keyframes |
| name        | TEXT    | Animation name                    |
| line_number | INTEGER | Line number (1-based)             |

### `meta` — Index metadata

| Key                   | Value                             |
| --------------------- | --------------------------------- |
| `last_indexed_commit` | Git SHA of HEAD when last indexed |
| `indexed_at`          | ISO timestamp of last index       |
| `file_count`          | Total files indexed               |
| `project_root`        | Absolute path to project          |
| `schema_version`      | Schema version number             |

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
-- `bun src/index.ts query --recipe components-by-hooks` (comma-based count on the stored JSON array).
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

## Maintenance

From this repository (same flags as the published **`codemap`** binary):

```bash
# Targeted — re-index only specific files you just modified
bun src/index.ts --files path/to/file.tsx path/to/other.ts

# Incremental — auto-detects changes via git
bun src/index.ts

# Full rebuild — after rebase, branch switch, or stale index
bun src/index.ts --full

# Check index freshness
bun src/index.ts query "SELECT key, value FROM meta"
```

**Prefer `--files`** when you know which files you changed — it skips git diff and filesystem scanning for the rest of the tree. Deleted files passed to `--files` are auto-removed from the index.

**End-user / npm** commands: **`templates/agents/skills/codemap/SKILL.md`** ( **`npx @stainless-code/codemap`**, **`codemap`** on **`PATH`**, etc.).

## Troubleshooting

| Problem                    | Solution                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Stale results after rebase | Run **`bun src/index.ts --full`** (or **`codemap --full`** when exercising the packaged CLI)                           |
| Missing file in results    | Check exclude / include globs in **`codemap.config.ts`**, **`codemap.config.json`**, or defaults in **`src/index.ts`** |
| `resolved_path` is NULL    | Import is an external package (not in project)                                                                         |
| Resolver errors            | Verify `tsconfig.json` paths (or **`tsconfigPath`** in config) when resolving aliases                                  |
