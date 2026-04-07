# @stainless-code/codemap

## 0.1.6

### Patch Changes

- [`ca4b47a`](https://github.com/stainless-code/codemap/commit/ca4b47a39a09e3bc6a554258ad7a827157d261c6) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Shipped agent rules and skills now lead with **`codemap query --json`** (optional table output when **`--json`** is omitted). Add **`bun run benchmark:query`** to compare **`console.table`** vs JSON stdout size, plus integration tests for **`--json`** vs default output when **`.codemap.db`** is present. README and **`docs/`** (including **`benchmark.md`** § Query stdout) updated to match.

## 0.1.5

### Patch Changes

- [#10](https://github.com/stainless-code/codemap/pull/10) [`9d37bd5`](https://github.com/stainless-code/codemap/commit/9d37bd508ea39dae33b7ec0d4b8de72e03d2e849) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **Agent templates (`templates/agents/`)**
  - Align **`codemap.mdc`** and **`skills/codemap/SKILL.md`** with the current **`codemap query --json`** contract (bootstrap / DB / SQL failures, **`process.exitCode`**).
  - SKILL: **`QUERY_RECIPES`**-aligned fan-out SQL examples and bundled-recipe determinism note.

## 0.1.4

### Patch Changes

- [#8](https://github.com/stainless-code/codemap/pull/8) [`889ed5b`](https://github.com/stainless-code/codemap/commit/889ed5b695823e9a57f133c9643af9dbb3e89236) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **Query CLI**
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

## 0.1.3

### Patch Changes

- [#6](https://github.com/stainless-code/codemap/pull/6) [`ad29694`](https://github.com/stainless-code/codemap/commit/ad2969481d4bd4e60d4f29818e4f1e64986216f9) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Align shipped agent templates with the published CLI (`codemap`, `npx @stainless-code/codemap`, …). Keep this repository’s `.agents/` rule and skill dev-oriented (`bun src/index.ts`). Remove the redundant `agents-first-convention` template. Document the dev vs `templates/agents/` split in `templates/agents/README.md` and `docs/agents.md`.

## 0.1.2

### Patch Changes

- [#4](https://github.com/stainless-code/codemap/pull/4) [`0a9d829`](https://github.com/stainless-code/codemap/commit/0a9d82935e775edfb942029c03b8a427f18f9e71) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **`codemap agents init`:** For Git repos, ensure **`.codemap.*`** is in **`.gitignore`** (create the file or append the line once). **`--force`** removes only template file paths (same relpaths under **`.agents/rules/`** and **`.agents/skills/`** as **`templates/agents`**) before merging; other files under **`.agents/`**, **`rules/`**, or **`skills/`** are kept. **`--interactive` / `-i`** — pick IDE integrations (Cursor, GitHub Copilot, Windsurf, Continue, Cline, Amazon Q, **`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`**) and symlink vs copy for rule mirrors; requires a TTY. Unknown positional arguments (e.g. `interactive` without `--interactive`) are rejected. Depends on **`@clack/prompts`**.

  **Docs:** **[`docs/agents.md`](https://github.com/stainless-code/codemap/blob/main/docs/agents.md)**; **[`docs/README.md`](https://github.com/stainless-code/codemap/blob/main/docs/README.md)** index updated. Root **[`.gitignore`](https://github.com/stainless-code/codemap/blob/main/.gitignore)** uses a single **`.codemap.*`** line.

## 0.1.1

### Patch Changes

- [#1](https://github.com/stainless-code/codemap/pull/1) [`b366c53`](https://github.com/stainless-code/codemap/commit/b366c532999800a1c0bb6e81aa68e6e8867baf83) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Consolidate docs (index hub, packaging/Releases, benchmark vs external root), point `.changeset/README` at packaging, and add `clean` / `check-updates` npm scripts.

## 0.1.0

### Minor Changes

- Initial release (**0.1.0**): structural SQLite index, CLI (`codemap`, `query`), programmatic API, Zod-validated `codemap.config`, Bun and Node support.
