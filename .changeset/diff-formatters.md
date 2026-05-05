---
"@stainless-code/codemap": minor
---

feat(query): add `--format diff` and `--format diff-json`

Adds transport-agnostic diff formatters for query row sets shaped as:

```sql
SELECT
  'src/file.ts' AS file_path,
  42 AS line_start,
  'oldName' AS before_pattern,
  'newName' AS after_pattern
```

- **`--format diff`** emits plain unified diff text, ready for `git apply --check`.
- **`--format diff-json`** emits `{files, warnings, summary}` for agents that need structured hunks.
- Source files are read at format time. If a file is missing or the indexed line no longer contains `before_pattern`, the formatter marks it `missing` / `stale` in `diff-json` and emits `# WARNING:` comments at the top of plain diff output.
- Same formatter support is exposed through MCP / HTTP `format: "diff" | "diff-json"` on `query` and `query_recipe`.

This is read-only preview infrastructure — codemap never writes files.
