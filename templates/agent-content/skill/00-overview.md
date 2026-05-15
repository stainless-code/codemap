---
name: codemap
description: Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding symbols, tracing dependencies, or auditing a project indexed by Codemap.
---

# Codemap — full reference

Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding symbols, tracing dependencies, or auditing a project indexed by **Codemap**.

## Bundled content (stay generic)

Examples below use **placeholders** (`'...'`, `getConfig`, `~/lib/api`, etc.) — not a real product tree. **Shipped skill and rules stay generic** so they apply to any repo.

**In your project:** run **`codemap agents init`** (ships **`.agents/`** from **[@stainless-code/codemap](https://www.npmjs.com/package/@stainless-code/codemap)**), or copy/symlink rules and skills manually (see your repo's contributor docs). Then **edit your copy** to add your team's tsconfig aliases, directory conventions, and SQL snippets you reuse. Treat upstream updates as a reference; merge deliberately.

**Run queries** (same CLI everywhere — use **`npx @stainless-code/codemap`**, **`pnpm dlx @stainless-code/codemap`**, **`yarn dlx @stainless-code/codemap`**, or **`bunx @stainless-code/codemap`** if **`codemap`** is not on your **`PATH`**):

```bash
codemap query --json "<SQL>"
```

**Human-readable:** Omit **`--json`** to print **`console.table`** (optional; wide results use more space than JSON).

Use **`codemap --root /path/to/project`** (or **`CODEMAP_ROOT`**) to index another tree.

## Query output and agents

- **`codemap query --json`** (default in examples above) prints a **JSON array** of row objects to stdout on success.
- **On failure**, stdout is a single object **`{"error":"<message>"}`** and the process exits **1**. This covers **invalid SQL**, **database open errors**, and **`query` bootstrap failures** (config load, resolver setup), not only SQL parse/runtime errors. The CLI sets **`process.exitCode`** instead of calling **`process.exit`**, so piped stdout is not cut off mid-stream.
- The CLI **does not cap** how many rows SQLite returns — add **`LIMIT`** and **`ORDER BY`** in SQL when you need a bounded list.
- When answering with structural facts from the index (lists of paths, symbols, dependency edges), **ground the answer in the query rows** — do not invent or silently drop rows. Use **`--json`** for large or multi-column results.
