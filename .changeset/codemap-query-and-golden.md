---
"@stainless-code/codemap": patch
---

**Query CLI**

- **`codemap query --json`**: print a JSON array of result rows to stdout (and **`{"error":"…"}`** on SQL errors) for agents and automation. Document that the query subcommand does **not** cap rows — use SQL **`LIMIT`** for bounded results. Update bundled agent rule and skill with **`--json`** preference, verbatim structural answers, and generic SQL recipes (fan-out + sample targets).

- **`codemap query --recipe <id>`** for bundled read-only SQL so agents can run common structural queries without embedding SQL on the command line. **`--json`** works with recipes the same way as ad-hoc SQL. Bundled ids include dependency **`fan-out`** / **`fan-out-sample`** / **`fan-out-sample-json`** (JSON1 **`json_group_array`**) / **`fan-in`**, index **`index-summary`**, **`files-largest`**, React **`components-by-hooks`** (comma-based hook count, no JSON1), and **`markers-by-kind`**. The benchmark suite uses the **`fan-out`** recipe SQL for an indexed-path scenario; docs clarify that recipes add no extra query cost vs pasting the same SQL.

- **Recipe discovery (no index / DB):** **`codemap query --recipes-json`** prints all bundled recipes (**`id`**, **`description`**, **`sql`**) as JSON. **`codemap query --print-sql <id>`** prints one recipe’s SQL. **`listQueryRecipeCatalog()`** in **`src/cli/query-recipes.ts`** is the single derived view of **`QUERY_RECIPES`** for the JSON output.

**Golden tests**

- **`bun run test:golden`**: index **`fixtures/minimal`**, run scenarios from **`fixtures/golden/scenarios.json`**, and compare query JSON to **`fixtures/golden/minimal/`**. Use **`bun scripts/query-golden.ts --update`** after intentional fixture or schema changes. Documented in **benchmark.md** and **CONTRIBUTING**.

**Query robustness**

- With **`--json`**, **`{"error":"…"}`** is printed for invalid SQL, database open failures, and **`codemap query`** bootstrap failures (config / resolver setup), not only bad SQL. The CLI sets **`process.exitCode`** instead of **`process.exit`** so piped stdout is not cut off mid-stream.

**Benchmark & `CODEMAP_BENCHMARK_CONFIG`**

- Each **`indexedSql`** in custom scenario JSON is validated as a single read-only **`SELECT`** (or **`WITH` … `SELECT`**) — DDL/DML and **`RETURNING`** are rejected before execution.
- Config file paths are resolved from **`process.cwd()`** (see **benchmark.md**). **`traditional.regex`** strings are developer-controlled (local JSON); **`files`** mode compiles the regex once per scenario.
- Overlapping **globs** in the traditional path are **deduplicated** so **Files read** / **Bytes read** count each path once.
- The default **components in `shop/`** scenario uses a **`LIKE`** filter aligned with the traditional globs under **`components/shop/`** (**\*.tsx** and **\*.jsx**, matching **`components`** rows from the parser) and avoids unrelated paths such as **`workshop`**.

**Recipes (determinism)**

- Bundled recipe SQL adds stable secondary **`ORDER BY`** columns (and orders inner **`LIMIT`** samples) so **`--recipe`** / **`--json`** output does not vary on aggregate ties.

**External QA**

- **`bun run qa:external`**: **`--max-files`** and **`--max-symbols`** must be positive integers (invalid values throw before indexing).
