---
"@stainless-code/codemap": patch
---

Add **`codemap query --recipe <id>`** for bundled read-only SQL so agents and scripts can run common structural queries without embedding SQL on the command line. **`--json`** works with recipes the same way as ad-hoc SQL.

Bundled ids include dependency **`fan-out`** / **`fan-out-sample`** / **`fan-out-sample-json`** (JSON1 **`json_group_array`**) / **`fan-in`**, index **`index-summary`**, **`files-largest`**, React **`components-by-hooks`** (comma-based hook count, no JSON1), and **`markers-by-kind`**.

Benchmark scenario 8 uses the **`fan-out`** recipe SQL for the indexed path; docs clarify that recipes add no extra query cost vs pasting the same SQL.
