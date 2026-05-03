-- Project-local recipe — exercises `<state-dir>/recipes/<id>.{sql,md}` discovery
-- and the `codemap query --recipe <id>` path. Frontmatter actions in the
-- sibling `.md` file attach a per-row hint to JSON output.
SELECT name, file_path, line_start, signature
FROM symbols
WHERE file_path LIKE 'src/components/shop/%'
  AND kind = 'function'
  AND is_exported = 1
ORDER BY file_path, line_start;
