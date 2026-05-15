---
actions:
  - type: review-barrel-chain
    description: "Each row resolves one re-export to its terminal definition site. `hops > 1` means the export travels through multiple barrel files before landing — common in monorepos, sometimes a sign of over-aggregated index.ts files. `truncated = 1` indicates the chain hit the depth cap or an unindexed file mid-walk."
---

# barrel-chains

Resolved re-export chains — every `export { X } from './bar'` in any indexed file followed to its terminal definition. Powers barrel-file auditing and "where is X really defined" agent queries.

```bash
codemap query --recipe barrel-chains
```

Filter to long chains (deep barrels):

```sql
SELECT * FROM re_export_chains WHERE hops >= 3 ORDER BY hops DESC;
```

Find barrels that re-export from outside the indexed set (truncated):

```sql
SELECT from_file, from_name, to_file FROM re_export_chains WHERE truncated = 1;
```

Find every barrel that re-exports a specific definition:

```sql
SELECT from_file, from_name FROM re_export_chains
WHERE to_file = 'src/components/Button.tsx' AND to_name = 'Button';
```

Chain depth is bounded at 10 hops (defensive against cycles). Resolution uses `imports.resolved_path` and the indexed-files set; bare specifiers (`react`, etc.) don't form chains.
