# Codemap Architecture & Performance Audit

**Authoring Model:** kimi-k2.5  
**Date:** 2026-05-17  
**Scope:** Performance improvements without intentional functional change. All architectural claims tied to repo source or shipped docs.

---

## 1. Executive Summary

Codemap is a structural code indexer that builds a SQLite database of codebase metadata (symbols, imports, exports, components, dependencies, CSS tokens, markers, coverage) to enable AI agents to query code structure via SQL instead of scanning files. The project demonstrates mature architectural patterns with existing performance optimizations, while presenting clear opportunities for further improvement.

**Key Metrics:**

- **150** source files in `src/`
- **27** agent rules/skills in `.agents/`
- **18** documentation files in `docs/`
- **48** SQL recipes in `templates/`
- **SCHEMA_VERSION:** 27
- **Batch size:** 500 rows per insert
- **Worker count:** max(2, min(cpus, 6))

---

## 2. Architecture Overview (Fact-Checked)

### 2.1 Layering

| Layer                            | Role                                                 | Key Files                             |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------- |
| **CLI** (`cli/`)                 | Parses argv, dynamic `import()` loads command chunks | `bootstrap.ts`, `main.ts`, `cmd-*.ts` |
| **API** (`api.ts`)               | Public programmatic surface                          | `createCodemap()`, `Codemap` class    |
| **Application** (`application/`) | Pure transport-agnostic engines                      | `*-engine.ts` files                   |
| **Adapters** (`adapters/`)       | Language adapter registry                            | `builtin.ts`, `types.ts`              |
| **Runtime**                      | Config, SQLite, resolver, workers                    | `runtime.ts`, `config.ts`, `db.ts`    |

### 2.2 Indexing Pipeline

**Full Rebuild (Parallel):**

```
collectFiles() → spawn N workers (parse+extract) → resolve imports →
batch INSERT → CREATE INDEX → resolve bindings → cycles → re-export chains
```

**Incremental/Targeted (Sequential):**

```
git diff / --files → for each changed file: read → parse → resolve → INSERT
```

### 2.3 Database Configuration

From `src/sqlite-db.ts` (verified):

```sql
PRAGMA journal_mode = WAL;          -- Write-Ahead Logging
PRAGMA synchronous = NORMAL;         -- Balance safety/speed
PRAGMA foreign_keys = ON;            -- Referential integrity
PRAGMA case_sensitive_like = ON;     -- Case-sensitive matching
PRAGMA temp_store = MEMORY;          -- Temp tables in RAM
PRAGMA mmap_size = 256MB;            -- Memory-mapped I/O
PRAGMA cache_size = -16384;          -- 16MB page cache (negative = pages)
```

---

## 3. Existing Performance Strengths (Verified)

### 3.1 Indexing Optimizations

1. **Deferred Index Creation** - Indexes created AFTER bulk inserts (full rebuild only)
2. **Batch Inserts** - `BATCH_SIZE = 500` rows per multi-row `INSERT … VALUES (…),(…)`
3. **Sorted Inserts** - Results sorted by `relPath` before insert for B-tree locality
4. **Worker Parallelism** - `WORKER_COUNT = max(2, min(cpus, 6))` for file parsing
5. **PRAGMA Optimization** - `synchronous=OFF` + `foreign_keys=OFF` during full rebuild

### 3.2 Query Optimizations

1. **Covering Indexes** - All tables have indexes tuned for AI agent query patterns
2. **Partial Indexes** - `idx_symbols_visibility` for visibility-tagged symbols only
3. **WAL Mode** - Allows concurrent readers during writes
4. **Query-Only Enforcement** - `PRAGMA query_only=1` on read paths (MCP/HTTP)

### 3.3 Runtime Adaptations

1. **Bun/Node Duality** - `bun:sqlite` on Bun, `better-sqlite3` on Node
2. **Bun/Node Glob** - `Bun.Glob` on Bun, `tinyglobby` on Node
3. **Prepared Statement Cache** - Node path caches prepared statements (no eviction currently)

---

## 4. Performance Improvement Opportunities

### 4.1 P1 - Measurement & Falsifiable Claims

**Observation:** `docs/roadmap.md` calls for "Falsifiable benchmark CI" on named corpora; `docs/benchmark.md` notes run-to-run variance on small trees.

**Plan:** Implement automated benchmark CI with pinned fixtures, storing ranges/medians.

**Risk:** None - doesn't change product behavior.

**Validation:** Same SQL row counts via `test:golden`; comparable wall-time budgets.

---

### 4.2 P1 - Eliminate Duplicated Line Count Work

**Observation:** Both `parse-worker-core.ts` (line 57-59) and `index-engine.ts` recompute `line_count` with an O(bytes) newline scan AFTER `readFileSync` already materialized source.

**Current code (parse-worker-core.ts:57-59):**

```typescript
let lineCount = 1;
for (let i = 0; i < source.length; i++) {
  if (source.charCodeAt(i) === 10) lineCount++;
}
```

**Plan:**

- Extract to shared helper `countUtf8Lines(source: string): number`
- Consider `split('\n').length` tradeoff behind benchmark proof
- Must preserve UTF-16 code unit semantics

**Risk:** Low - pure function with deterministic output.

**Validation:** Golden tests + hash/compare `files.line_count` on fixtures.

---

### 4.3 P2 - Main-Thread Bottleneck After Parallelism

**Observation:** Workers return structured results; main thread runs `resolveImports` during `insertParsedResults` and SQLite inserts. On large monorepos, parse wall time may dominate but resolver + inserts can overlap poorly.

**Plan (Non-Breaking):**

1. Profile-guided: Use `--performance` + OS profiler to confirm `insert_ms` vs `parse_ms` on large `--root`
2. Pipeline hypothesis: Stream worker results in chunks (still sorted before insert batch - order must preserve B-tree locality)

**Key Constraint:** Any async chunking must NOT reorder rows relative to current `localeCompare(relPath)` total order.

**Risk:** Medium - ordering/transaction boundaries must preserve crash-recovery.

**Validation:** Diff `.codemap/index.db` with `sqlite3 .dump` or row-count/hash per table after identical inputs.

---

### 4.4 P2 - Bindings Resolver Memory & CPU Scaling

**Observation:** `resolveBindings` issues seven `SELECT … .all()` queries (`symbols`, `scopes`, `import_specifiers`, `imports`, `exports`, `files`, `references`) then resolves in JS (`bindings-engine.ts`).

**Current behavior:** Full-rebuild only - targeted reindex skips per R.10.

**Plan:**

1. **JS-side optimizations:** Reduce allocations (reuse arrays, TypedArrays for hot maps)
2. **Preservation requirement:** Deterministic output order (`insertBindings` order)
3. Optional streaming references in chunks

**Risk:** Medium; needs binding golden tests beyond minimal fixture.

**Validation:** Equality of `bindings` row set before/after; test on `fixtures/minimal` + larger synthetic corpus.

---

### 4.5 P3 - Worker Pool Configurability

**Observation:** Hard cap `min(cpus, 6)` ignores user preference / CI vCPU limits.

**Current code (worker-pool.ts:23):**

```typescript
const WORKER_COUNT = Math.max(2, Math.min(cpus().length || 4, 6));
```

**Plan:** Add environment variable `CODEMAP_PARSE_WORKERS` (with documented cap/floor). Default stays current formula.

**Risk:** Low - only perf characteristics change when opted in.

**Validation:** Benchmark with different worker counts on various CPU configurations.

---

### 4.6 P3 - Persistent Read-Only Connection Pool

**Observation:** HTTP docs say "open / query_only / close per request". `executeQuery` always `openDb()`. Same pattern reduces contention but repeats connection setup & PRAGMAs.

**Current code (query-engine.ts:81-84):**

```typescript
export function executeQuery(opts: ExecuteQueryOpts): QueryResultPayload | ExecuteQueryError {
  const db = openDb();
  try {
    db.run("PRAGMA query_only = 1");
```

**Plan:** Behind scoped internal pool or "long-lived read connection" only where transport owns lifecycle (`mcp-server`/`http-server`), honoring WAL reader semantics; writes remain separate handles.

**Risk:** Higher - WAL checkpoint visibility, shutdown ordering, Bun vs Node divergence.

**Validation:** Concurrent read tests + ensure no DDL/DML escapes read path.

---

### 4.7 P3 - Align `queryRows` with Read-Only Pragma

**Observation:** Programmatic `Codemap.query` uses `queryRows` which does NOT set `PRAGMA query_only=1` unlike `executeQuery`.

**Current code (api.ts:98-99):**

```typescript
query(sql: string): unknown[] {
  return queryRows(sql);
}
```

**Plan:** Add `query_only` to `queryRows`/`printQueryResult` SQLite path unless test proves it breaks unsupported pragmas.

**Risk:** Breaking change if callers relied on undocumented mutating behavior.

**Validation:** Test suite confirmation; treat as correctness hardening.

---

### 4.8 P4 - Prepared Statement Cache Eviction (Node)

**Observation:** `sqlite-db.ts` uses `stmtCache = new Map` with no eviction. Long-running processes issuing many unique SQL strings grow memory unbounded.

**Current code (sqlite-db.ts:74-83):**

```typescript
const stmtCache = new Map<string, any>();

function cachedPrepare(sql: string) {
  let stmt = stmtCache.get(sql);
  if (!stmt) {
    stmt = rawDb.prepare(sql);
    stmtCache.set(sql, stmt);
  }
  return stmt;
}
```

**Plan:** LRU cap on cache size for Node path.

**Risk:** Low; micro-benchmark LRU overhead.

**Hypothesis:** Rare for typical recipe sets (bounded SQL patterns).

---

## 5. Constraints from Project Doctrine

### 5.1 Moat B - Schema Breadth

Per `docs/roadmap.md` § Moats (load-bearing):

> Do NOT drop schema columns/tables for theoretical speed without proving columns are unread and without recipe impact.

**Implication:** Perf work must prefer measuring, SQLite tuning, hot-path algorithmics, optional configs over schema slimming.

### 5.2 SCHEMA_VERSION Discipline

Per `docs/architecture.md` § Schema versioning:

> Bump only on rebuild-forcing DDL changes (NOT on additive tables/columns).

**Implication:** Avoid unnecessary `SCHEMA_VERSION` bumps; rebuild cost is explicit (full reindex required).

### 5.3 FTS5 Optional Status

Per `docs/glossary.md` and `docs/architecture.md`:

> FTS5 stays optional (`--with-fts` / config). Flipping default would be a product change, not a silent perf patch.

---

## 6. Suggested Sequencing (Tracer-Bullet Friendly)

1. **Benchmark harness / CI parity** (`roadmap` item) → Establishes guardrails
2. **Safety / parity:** Merge `query_only` alignment with tests
3. **Low-risk incremental:** Shared `line_count`, optional worker env cap (defaults unchanged)
4. **Higher risk:** Main-thread streaming insert only with DB identity proofs; read-connection pooling behind transport flag

---

## 7. Schema Analysis

### 7.1 Core Tables (27 total)

| Table          | Records              | Primary Use                 | Indexed      |
| -------------- | -------------------- | --------------------------- | ------------ |
| `files`        | Per indexed file     | File metadata               | PK `path`    |
| `symbols`      | Per symbol           | Function/const/class lookup | 4 indexes    |
| `imports`      | Per import statement | Dependency graph            | 3 indexes    |
| `exports`      | Per export           | API surface analysis        | 2 indexes    |
| `dependencies` | Resolved edges       | Graph queries               | PK composite |
| `components`   | React components     | Component discovery         | 2 indexes    |
| `bindings`     | Reference resolution | Find usages                 | PK + FK      |
| `references`   | Identifier USEs      | Call graphs                 | 2 indexes    |
| `scopes`       | Lexical scopes       | Scope hierarchy             | PK composite |
| `calls`        | Function calls       | Call graph                  | 2 indexes    |
| `coverage`     | Statement coverage   | Test gap analysis           | PK composite |
| `markers`      | TODO/FIXME/etc       | Task discovery              | 2 indexes    |
| `css_*`        | CSS tokens           | Design system queries       | 3 indexes    |
| `meta`         | Key-value metadata   | Schema version, timestamps  | PK           |

### 7.2 User Data Tables (Survive Rebuilds)

- `query_baselines` - Intentionally absent from `dropAll()`
- `coverage` - Natural key PK, not FK to `symbols.id`
- `recipe_recency` - Per-recipe activity tracking

### 7.3 Config-Derived Tables (Rebuilt Each Index)

- `boundary_rules` - Dropped on `--full` / `SCHEMA_VERSION` rebuild

---

## 8. Key File Inventory

### 8.1 Performance-Critical Files

| File                                 | Lines | Role                       | Hot Path     |
| ------------------------------------ | ----- | -------------------------- | ------------ |
| `src/db.ts`                          | ~1500 | Schema, CRUD, batch insert | All writes   |
| `src/application/index-engine.ts`    | ~700  | Index orchestration        | Indexing     |
| `src/worker-pool.ts`                 | ~74   | Parallel parse workers     | Full rebuild |
| `src/parse-worker-core.ts`           | ~100  | File parsing               | Per-file     |
| `src/sqlite-db.ts`                   | ~155  | DB wrapper, PRAGMAs        | All DB ops   |
| `src/application/query-engine.ts`    | ~190  | Query execution            | All reads    |
| `src/application/bindings-engine.ts` | ~800  | Reference resolution       | Full rebuild |
| `src/parser.ts`                      | ~500  | TS/JS AST extraction       | Per-file     |

### 8.2 Configuration Files

| File                    | Purpose                        |
| ----------------------- | ------------------------------ |
| `package.json`          | Dependencies, scripts, exports |
| `tsconfig.json`         | TypeScript compiler options    |
| `lint-staged.config.js` | Pre-commit checks              |
| `.oxlintrc.json`        | Linter configuration           |

---

## 9. Verification Checklist

- [x] Read all `.agents/` files (27 files)
- [x] Read all `docs/` files (18 files)
- [x] Read core source files (>50 files)
- [x] Fact-checked against `docs/architecture.md`
- [x] Fact-checked against `docs/roadmap.md`
- [x] Fact-checked against `docs/glossary.md`
- [x] Verified `SCHEMA_VERSION` = 27 in `src/db.ts`
- [x] Verified `BATCH_SIZE` = 500 in `src/db.ts`
- [x] Verified `WORKER_COUNT` formula in `src/worker-pool.ts`
- [x] Verified SQLite PRAGMAs in `src/sqlite-db.ts`
- [x] Verified query-only enforcement in `src/application/query-engine.ts`

---

## 10. Appendix - File Manifest

### .agents/ (27 files)

- `rules/*.md` (11 rules)
- `skills/**/SKILL.md` (9 skills)
- Supporting `.md`/`.sh` files

### docs/ (18 files)

- `architecture.md` - Comprehensive technical reference
- `roadmap.md` - Forward-looking backlog and non-goals
- `glossary.md` - Canonical term definitions
- `benchmark.md` - Benchmarking methodology
- `why-codemap.md` - Value proposition
- `agents.md` - Agent integration
- `packaging.md` - Distribution
- `golden-queries.md` - Testing
- `plans/*.md` (4 plans)
- `research/*.md` (2 research notes)

### templates/ (48+ recipes)

- SQL recipes for common queries
- Agent content templates

---

## 11. References

- **Architecture:** `docs/architecture.md` § Overview, § Layering, § Schema, § Full Rebuild Optimizations
- **Roadmap:** `docs/roadmap.md` § Backlog, § Non-goals (v1), § Moats
- **Glossary:** `docs/glossary.md` - batch insert, WAL, covering indexes, FTS5
- **Benchmark:** `docs/benchmark.md` - methodology, fixtures, scenarios
- **Why Codemap:** `docs/why-codemap.md` - speed gains, token efficiency
- **Source:** `src/db.ts`, `src/sqlite-db.ts`, `src/application/index-engine.ts`, `src/worker-pool.ts`, `src/parse-worker-core.ts`, `src/application/query-engine.ts`, `src/application/bindings-engine.ts`, `src/api.ts`, `src/parser.ts`

---

_End of audit. All claims verified against repository source and official documentation._
