---
"@stainless-code/codemap": patch
---

**Query CLI**

- **`codemap query --json`**: print a JSON array of result rows to stdout (and **`{"error":"…"}`** on SQL errors) for agents and automation. Document that the query subcommand does **not** cap rows — use SQL **`LIMIT`** for bounded results. Update bundled agent rule and skill with **`--json`** preference, verbatim structural answers, and generic SQL recipes (fan-out + sample targets).

- **`codemap query --recipe <id>`** for bundled read-only SQL so agents can run common structural queries without embedding SQL on the command line. **`--json`** works with recipes the same way as ad-hoc SQL. Bundled ids include dependency **`fan-out`** / **`fan-out-sample`** / **`fan-out-sample-json`** (JSON1 **`json_group_array`**) / **`fan-in`**, index **`index-summary`**, **`files-largest`**, React **`components-by-hooks`** (comma-based hook count, no JSON1), and **`markers-by-kind`**. Benchmark scenario 8 uses the **`fan-out`** recipe SQL for the indexed path; docs clarify that recipes add no extra query cost vs pasting the same SQL.

**Golden tests**

- **`bun run test:golden`**: index **`fixtures/minimal`**, run scenarios from **`fixtures/golden/scenarios.json`**, and compare query JSON to **`fixtures/golden/minimal/`**. Use **`bun scripts/query-golden.ts --update`** after intentional fixture or schema changes. Documented in **benchmark.md** and **CONTRIBUTING**.
