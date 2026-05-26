## Maintenance

From the **[@stainless-code/codemap](https://www.npmjs.com/package/@stainless-code/codemap)** CLI (see the **codemap** rule for **`npx` / `pnpm dlx` / `yarn dlx` / `bunx`** invocations):

```bash
# Targeted — re-index only specific files you just modified
codemap --files path/to/file.tsx path/to/other.ts

# Incremental — auto-detects changes via git
codemap

# Full rebuild — after rebase, branch switch, or stale index
codemap --full

# Check index freshness
codemap query --json "SELECT key, value FROM meta"
```

**Prefer `--files`** when you know which files you changed — it skips git diff and filesystem scanning for the rest of the tree. Deleted files passed to `--files` are auto-removed from the index.

Same flags as **`npx @stainless-code/codemap`**, **`pnpm dlx @stainless-code/codemap`**, etc. **`codemap --root /path/to/project`** indexes another working tree.

**Full-text search (opt-in):** pass **`--with-fts`** on index runs, or set **`fts5: true`** in `.codemap/config` — populates the `source_fts` virtual table for `show --query` / `snippet --query` / MCP `show` / `snippet` when `with_fts: true`. Default OFF until measurement closes [FTS default-on evaluation](../../docs/plans/fts-default-on-evaluation.md).
