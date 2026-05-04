# Codemap capability surface and extension paths

> **Type:** Research snapshot (2026-05).
> **Scope:** What the **current codebase indexes, exposes, and wires** (CLI, schema, recipes, audit), plus **plausible next steps** grounded in that substrate. This note intentionally does **not** argue from `roadmap.md` non-goals—it describes **implemented facts** and **engineering ladders** from here.
> **Canonical homes:** Structural behavior and schema evolution live in [`docs/architecture.md`](../architecture.md) and [`src/db.ts`](../../src/db.ts). Positioning vs other tools stays in [`docs/why-codemap.md`](../why-codemap.md); competitive context in [`research/competitive-scan-2026-04.md`](./competitive-scan-2026-04.md) and [`research/fallow.md`](./fallow.md).

---

## Methodology

Findings grounded in:

- `createTables` / `SCHEMA_VERSION` in `src/db.ts`
- Built-in parsers in `src/adapters/builtin.ts`
- CLI routing in `src/cli/main.ts`
- Audit delta registry `V1_DELTAS` in `src/application/audit-engine.ts`
- Impact walker in `src/application/impact-engine.ts`
- Bundled recipe inventory via `codemap query --recipes-json` (15 ids)
- `templates/recipes/*.sql` (notably `fan-in.sql` semantics)

Re-index this repo before treating any **local** row counts as authoritative.

---

## Implemented database surface

**Index tables (structural):** `files`, `symbols`, `imports`, `exports`, `components`, `dependencies`, `markers`, `css_variables`, `css_classes`, `css_keyframes`, `calls`, `type_members`.

**Metadata / user data (same DB file):** `meta` (key/value), `query_baselines` (saved query snapshots for `--save-baseline` / `--baseline`), `coverage` (Istanbul / LCOV ingested via `codemap ingest-coverage`, natural-key join to symbols—not a foreign key to `symbols.id` because full reindex recreates symbol rows).

**Schema version:** `SCHEMA_VERSION` in `src/db.ts` (bump on DDL change; mismatch triggers rebuild path documented in architecture).

**Notable symbol columns:** `doc_comment`, `visibility`, export flags, `parent_name`, optional `value`.

**Notable export column:** `re_export_source` (re-export chain hint at export row level).

**Dependencies:** `dependencies` stores resolved **module** edges `(from_path, to_path)`; `imports` stores per-import rows with `source`, `resolved_path`, specifiers.

---

## Indexing / language coverage (built-ins)

`BUILTIN_ADAPTERS` in `src/adapters/builtin.ts`:

1. **TS/JS family** — `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs` → `extractFileData` (oxc AST path).
2. **CSS** — `.css` → Lightning CSS extraction + markers.
3. **Text / markers** — `.md`, `.mdx`, `.mdc`, `.yml`, `.yaml`, `.txt`, `.json`, `.sh` → markers only (no full TS-style symbol graph for those bodies).

Community registration beyond this file is an **architectural extension** (adapter types exist under `src/adapters/types.ts`).

---

## CLI capabilities (shipped commands)

From `src/cli/main.ts` (non-exhaustive detail—see each `cmd-*.ts`):

| Command               | Role                                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(default)_           | Incremental / full index (`cmd-index.ts`)                                                                                                          |
| `query`               | Ad-hoc SQL + recipes; baselines; `--changed-since`, `--group-by`, `--summary`; `--format text\|json\|sarif\|annotations` (`cmd-query.ts`)          |
| `audit`               | Structural diff vs saved baselines and/or `--base <ref>` (worktree + cache); envelope `deltas` per `V1_DELTAS` (`cmd-audit.ts`, `audit-engine.ts`) |
| `impact`              | Bounded graph walks over `dependencies` / `calls` / `imports` (`impact-engine.ts`)                                                                 |
| `ingest-coverage`     | Populate `coverage` from coverage-final.json / lcov (`cmd-ingest-coverage.ts`, `coverage-engine.ts`)                                               |
| `show`, `snippet`     | Targeted symbol lookup + optional disk snippet (`cmd-show.ts`, `cmd-snippet.ts`)                                                                   |
| `context`, `validate` | Agent-oriented envelopes / hash staleness checks                                                                                                   |
| `mcp`, `serve`        | JSON-RPC MCP + HTTP API over shared tool handlers                                                                                                  |
| `watch`               | Live reindex (chokidar)                                                                                                                            |
| `agents init`         | Template install under `.agents/`                                                                                                                  |

---

## Bundled recipes (15)

Confirmed via `codemap query --recipes-json`:

`barrel-files`, `components-by-hooks`, `deprecated-symbols`, `fan-in`, `fan-out`, `fan-out-sample`, `fan-out-sample-json`, `files-by-coverage`, `files-hashes`, `files-largest`, `index-summary`, `markers-by-kind`, `untested-and-dead`, `visibility-tags`, `worst-covered-exports`.

**Important nuance:** `fan-in.sql` ranks **`to_path` by inbound edge count (`ORDER BY fan_in DESC LIMIT 15`)**—dependency **hotspots**, not “files with zero fan-in” / orphan detection. There is **no** bundled recipe id `zero-fan-in*` in `templates/recipes/`; orphan heuristics are custom SQL / future recipes.

**Per-row actions:** Recipe metadata can attach `actions` (YAML frontmatter on paired `.md` files); merge logic lives in `src/application/query-recipes.ts`. Nine bundled recipes ship an `actions` block in frontmatter today (grep `^actions:` under `templates/recipes/` to refresh).

---

## Audit v1 deltas (exactly three)

`V1_DELTAS` in `src/application/audit-engine.ts`:

| Key            | Canonical projection shape                                     |
| -------------- | -------------------------------------------------------------- |
| `files`        | `SELECT path FROM files ORDER BY path`                         |
| `dependencies` | `SELECT from_path, to_path FROM dependencies ORDER BY …`       |
| `deprecated`   | Symbols with `@deprecated` in `doc_comment` (fixed column set) |

No built-in audited delta keys for **cycles**, **duplicate code**, **unused exports validated from entrypoints**, or **architecture zones**—those would be **new audit specs + SQL contracts** if added.

---

## What is logically absent today (still factual)

These are **not** “forbidden”—they are **not implemented** in the tree as first-class engines:

- **Reachability from app entrypoints** (framework-aware “live” file set). `dependencies` answer “import graph,” not “reachable from `main` / Next pages / `exports` field” without extra rules.
- **Closed dead subgraphs:** internal research (`research/fallow.md`) records a case where every file in an unused pack had **non-zero** `dependencies` fan-in because the pack imported itself; **hotspot / fan-in SQL does not detect** that class of dead code.
- **Duplication / clone detection** (suffix-array or otherwise).
- **Dedicated cycle or boundary product**—could be **expressed** as SQL over `dependencies`, but no shipped command or audit row-type owns it.
- **First-party GitHub Marketplace Action**—consumers wire `codemap query --format sarif|annotations` (or upload SARIF) in their own workflow.

---

## Extension paths from the current substrate

Ordered by how directly they reuse **existing tables + indexer + query/audit/SARIF pipeline**:

1. **New recipes + optional new audit delta keys** — Any finding expressible as **deterministic SQL** over current columns (including `WITH RECURSIVE` for cycles) can ship as `--recipe` and optionally as a **named audit snapshot** with the same column contract pattern as `V1_DELTAS`.
2. **Materialized columns / tables at index time** — e.g. **`is_entry`**, **package id**, **reachable** bit, **custom boundary zone** per file—extends the indexer and schema; unlocks **entry-grounded** dead-file queries without abandoning SQLite.
3. **`audit` verdict envelope** — Today: `{ head, deltas }` with `added`/`removed`; roadmap sketch for threshold-driven `verdict` is a **downstream** change to `audit-engine` + config—data already exists.
4. **Workspace / monorepo partitioning** — Split or tag **dependency** / **file** rows by package root; same query surface, clearer ownership queries.
5. **New analysis passes** — Duplication, churn, complexity metrics: **new extractors** (AST or git) writing **new tables**; then **same** baselines, SARIF, MCP, HTTP.
6. **Packaging** — Composite **GitHub Action** (install tool, index, `query --format sarif`, upload) is **CI glue**, not core index capability.

---

## Relation to “graph-level” tools (e.g. Fallow-class)

**Already strong:** Ad-hoc **structural** questions—fan-in/out, exports, calls, components/hooks, CSS artifacts, markers, type members, **impact** walks, **ref-scoped** structural diffs, **coverage-joined** recipes—are **native** to this codebase.

**Requires new materialized facts:** Entry-grounded **unused files**, **high-fidelity unused exports** through barrels, **dupes**, and **opinionated boundary enforcement** need **additional indexer or post-index passes** (and possibly config), not only prettier SQL on today’s `dependencies` edge list.

---

## Closing

This file is a **snapshot** of the capability boundary **as implemented**. When major schema or CLI surfaces change, either update this note in the same commit or slim it to a pointer into `architecture.md` per [docs/README.md § Rule 8](../README.md) research-closing discipline.
