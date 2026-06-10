---
alwaysApply: true
---

# Codemap

> **STOP.** Before you call Grep, Glob, SemanticSearch, or Read to answer a **structural** question about **this project** — query the Codemap SQLite index first.

This project is indexed by **Codemap** — a local SQLite database (default **`.codemap/index.db`**) of structure: `files`, `symbols`, `imports`, `exports`, `dependencies`, `calls`, `components`, `markers`, `type_members`, `type_heritage`, `import_specifiers`, `scopes`, `references`, `bindings`, `function_params`, `dynamic_imports`, `jsx_elements`, `jsx_attributes`, `async_calls`, `try_catch`, `decorators`, `jsdoc_tags`, `runtime_markers`, `test_suites`, `re_export_chains`, `module_cycles`, `file_metrics`, `css_variables`, `css_classes`, `css_keyframes`, `suppressions`, `boundary_rules`, and (after `codemap ingest-coverage <path>`) `coverage`. Full DDL: `codemap query --json "SELECT sql FROM sqlite_schema WHERE type='table'"` or MCP resource `codemap://schema`.

## How to query

```bash
codemap query --json "<SQL>"               # ad-hoc SQL (JSON output)
codemap query --json --recipe <id>         # recipe SQL (bundled or project-local; stable ordering + per-row actions)
codemap query --recipes-json               # canonical list of every bundled + project-local recipe id
```

**Use `DISTINCT`** on dependency / import queries — a file importing multiple specifiers from the same module produces duplicate rows.

**Row count:** no cap; add `LIMIT` and `ORDER BY` when you need bounded output. On failure, stdout is `{"error": "..."}` and the process exits 1.

**Evidence columns:** Some recipe rows (e.g. `boundary-violations`, `deprecated-symbols`, `unimported-exports`) add **`reason`** and **`evidence_json`** — factual detection path for agents, not pass/fail verdicts (`unimported-exports` includes `unresolved_import_blind_spot` when unresolved imports name the export).

**Coverage columns:** `high-crap-score` rows add **`coverage_source`** (`measured` \| `estimated`) and **`effective_coverage_pct`** — measured when `ingest-coverage` has a symbol row; else graph tiers 85/40/0% from test reachability (heuristic, not execution).

**Confidence columns:** `coverage-confirmed-dead` rows add **`confidence`** (`high` \| `medium`) — `high` when static dead and ingested `coverage_pct = 0`; `medium` when dead but unmeasured. Parse before deletion.

**Audit attribution:** `codemap audit --base <ref>` (and MCP/HTTP `audit` with `base`) tags each `added` row with **`attribution: introduced | inherited`** — branch-new vs pre-existing at merge base. Filter actionable PR deltas with `jq '.deltas.deprecated.added[] | select(.attribution == "introduced")'`.

## Trigger patterns

If the question matches any of these, use the index instead of grepping:

| Question shape                                               | Table(s) / Recipe                                                                                                                                    |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| "What/which files import X?"                                 | `imports` (by `source`) or `dependencies` (by `to_path`)                                                                                             |
| "Where is X defined?"                                        | `symbols`                                                                                                                                            |
| "What does file X export?"                                   | `exports`                                                                                                                                            |
| "Who depends on file X?" / "What does file X depend on?"     | `dependencies`                                                                                                                                       |
| "Who calls X?" / "What does X call?"                         | `calls`                                                                                                                                              |
| "Where is X used?" / "Every reference to X"                  | `--recipe find-references` (name-keyed)                                                                                                              |
| "Every reference to X defined in file Y" (precise rename)    | `--recipe find-symbol-references` (bindings-precise)                                                                                                 |
| Homonym-safe rename (scoped definition anchor)               | `--recipe rename-preview` with `define_in=<file_path>`; CLI `codemap rename <old> <new> [--define-in <file_path>] [--in-file <prefix>] [--kind <k>]` |
| "Every write to X"                                           | `--recipe find-write-sites`                                                                                                                          |
| "Every fn taking a `User` param"                             | `--recipe find-by-param-type` (params `type_text=...`)                                                                                               |
| "What hooks does component X use?" / "List React components" | `components`                                                                                                                                         |
| "What are the CSS variables/tokens for X?"                   | `css_variables`                                                                                                                                      |
| "What CSS classes / keyframes are in X?"                     | `css_classes` / `css_keyframes`                                                                                                                      |
| "Find all TODOs / FIXMEs / HACKs / NOTEs"                    | `markers`                                                                                                                                            |
| "What fields does interface/type X have?"                    | `type_members`                                                                                                                                       |
| "What does X extend / implement?" / type hierarchy           | `type_heritage` / `--recipe type-ancestors` / `--recipe type-descendants`                                                                            |
| "Is X deprecated?" / "What's `@beta` / `@internal`?"         | `symbols.doc_comment` / `symbols.visibility`                                                                                                         |
| "Leftover `console.log` calls"                               | `--recipe find-leftover-console` (or `runtime_markers`)                                                                                              |
| "What `process.env.X` vars does this app read?"              | `--recipe env-var-audit`                                                                                                                             |
| "Find `.skip` / `.only` / `.todo` tests"                     | `--recipe find-skipped-tests`                                                                                                                        |
| "Tests per file (counts + framework)"                        | `--recipe tests-by-file`                                                                                                                             |
| "Are there import cycles?" / "Files in cycles"               | `--recipe circular-imports` / `module_cycles`                                                                                                        |
| "Where do barrel files re-export from?"                      | `--recipe barrel-chains` / `re_export_chains`                                                                                                        |
| "Functions over 50 lines / deeply nested"                    | `--recipe large-functions` / `deeply-nested-functions`                                                                                               |
| "What's the cyclomatic / cognitive complexity of X?"         | `symbols.complexity` / `symbols.cognitive_complexity` (Sonar-inspired; class methods included)                                                       |
| "What's the nesting depth of X?"                             | `symbols.nesting_depth`                                                                                                                              |
| "Is symbol X tested?" / "What's the coverage of file Y?"     | `coverage` (after `codemap ingest-coverage`)                                                                                                         |
| "What's structurally dead AND untested?"                     | `--recipe untested-and-dead`                                                                                                                         |
| "Dead exports with ingested zero coverage?"                  | `--recipe coverage-confirmed-dead` (check `confidence`: `high` vs `medium`)                                                                          |
| "Worst-covered exported functions"                           | `--recipe worst-covered-exports`                                                                                                                     |
| "Which exports has nobody imported?"                         | `--recipe unimported-exports`                                                                                                                        |
| "Which components touch deprecated APIs?"                    | `--recipe components-touching-deprecated`                                                                                                            |
| "What's risky to refactor right now?"                        | `--recipe refactor-risk-ranking`                                                                                                                     |
| "What's high-complexity AND undertested?"                    | `--recipe high-complexity-untested` (needs `ingest-coverage`; without ingest prefer `high-crap-score`)                                               |
| "Complex + undertested without coverage ingest?"             | `--recipe high-crap-score` (graph-estimated tiers; `coverage_source: estimated`)                                                                     |
| "What's cognitively complex (nesting-heavy)?"                | `--recipe high-cognitive-complexity` (default `min_score=15`; `--params min_score=20` to tighten)                                                    |

## Quick reference queries

| I need to...              | Query                                                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Find a symbol             | `SELECT name, kind, file_path, line_start, signature FROM symbols WHERE name = '...'`                                        |
| Field-qualified search    | `codemap show --query 'kind:function name:Auth path:src/'` (MCP: `show` / `snippet` with `query`)                            |
| Call path / neighborhood  | `codemap trace` / `explore` / `node` (or MCP twins; recipes: `call-path`, `symbol-neighborhood`)                             |
| Affected tests            | `codemap affected --json` or MCP `affected` (recipe: `affected-tests`)                                                       |
| Find a symbol (fuzzy)     | `SELECT name, kind, file_path, line_start FROM symbols WHERE name LIKE '%...%'`                                              |
| Symbol docs               | `SELECT name, signature, doc_comment FROM symbols WHERE name = '...'`                                                        |
| Who imports this file?    | `SELECT DISTINCT from_path FROM dependencies WHERE to_path LIKE '%...'`                                                      |
| What does this depend on? | `SELECT DISTINCT to_path FROM dependencies WHERE from_path LIKE '%...'`                                                      |
| Who calls X?              | `SELECT DISTINCT caller_name, file_path FROM calls WHERE callee_name = '...' AND (provenance IS NULL OR provenance = 'ast')` |
| Component info            | `SELECT name, props_type, hooks_used FROM components WHERE name = '...'`                                                     |
| TODOs in a file           | `SELECT line_number, content FROM markers WHERE file_path LIKE '%...' AND kind = 'TODO'`                                     |
| Deprecated symbols        | `SELECT name, kind, file_path FROM symbols WHERE doc_comment LIKE '%@deprecated%'`                                           |
| Symbol coverage           | `SELECT name, hit_statements, total_statements, coverage_pct FROM coverage WHERE file_path = '...'`                          |
| Untested + dead exports   | `codemap query --json --recipe untested-and-dead`                                                                            |
| Coverage-confirmed dead   | `codemap query --json --recipe coverage-confirmed-dead` (sort by `confidence`)                                               |

## When Grep / Read IS appropriate

- Reading implementation details you need to edit.
- Reviewing logic, control flow, or business rules.
- Searching for patterns the index doesn't capture (string literals inside function bodies, inline conditions, etc.).

## Keeping the index fresh

After editing source files in this conversation, re-index before the next query:

```bash
codemap --files path/to/file1.tsx path/to/file2.ts   # targeted (fastest)
codemap                                              # incremental (auto-detects via git)
codemap --full                                       # after rebase, branch switch, or stale index
```

## Full reference

This rule covers priming. For the full CLI / recipes / schema DDL / MCP + HTTP / audit / apply / baseline reference, fetch the skill:

- **CLI:** `codemap skill`
- **MCP:** read resource `codemap://skill`
- **HTTP:** `GET /resources/{encoded-uri}` against `codemap serve`

This rule itself is also served live: **`codemap rule`** / **`codemap://rule`** / the HTTP equivalent. The on-disk `.agents/rules/codemap.md` and `.agents/skills/codemap/SKILL.md` are thin pointers — `bun update @stainless-code/codemap` auto-refreshes the served content without re-running `agents init`.

<!-- codemap-pointer-version: 1 -->
