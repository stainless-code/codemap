# Codex 5.3 Performance Architecture Audit (No Behavior Change)

Date: 2026-05-17

## Scope + coverage (fact-checked)

- Tracked files baseline: `415` (`git ls-files | wc -l`).
- Coverage pass (exhaustive accounting): `390` text-read, `22` symlinks, `3` empty placeholders, `0` binary/unreadable.
- `.agents/**` and `docs/**`: all tracked files explicitly read and audited.
- Runtime architecture/hot paths additionally verified directly in code:
  - `src/application/query-engine.ts`
  - `src/application/tool-handlers.ts`
  - `src/application/run-index.ts`
  - `src/application/index-engine.ts`
  - `src/group-by.ts`
  - `src/worker-pool.ts`
  - `src/parse-worker-core.ts`
  - `src/sqlite-db.ts`
  - `src/db.ts`
  - `src/git-changed.ts`
  - `.github/workflows/ci.yml`
  - `.github/actions/setup/action.yml`
  - `action.yml`

## Fact-check sources used

### Codebase + docs

- Architecture and runtime docs: `docs/architecture.md`, `docs/benchmark.md`, `docs/packaging.md`, `docs/roadmap.md`, `docs/glossary.md`.
- Codemap SQL evidence (from fresh `bun src/index.ts --full` index):
  - largest files, complexity hotspots, file_metrics concentration
  - import concentration and `node:child_process` usage sites

### Official docs

- SQLite WAL: <https://www.sqlite.org/wal.html>
- SQLite `PRAGMA optimize` guidance: <https://www.sqlite.org/pragma.html#pragma_optimize>
- Bun SQLite API + statement caching semantics: <https://bun.sh/docs/api/sqlite>
- Bun worker runtime behavior: <https://bun.sh/docs/runtime/workers>

## Architecture snapshot (current, evidence-backed)

- DB runtime split: `bun:sqlite` on Bun, `better-sqlite3` on Node (`src/sqlite-db.ts`).
- DB opened with WAL + tuning PRAGMAs (`journal_mode=WAL`, `synchronous=NORMAL`, `mmap_size`, `cache_size`) in `openCodemapDatabase()`.
- Close path runs `PRAGMA analysis_limit = 400` + `PRAGMA optimize` unless readonly (`src/db.ts` `closeDb`).
- Full rebuild path uses workers + deferred index creation (`src/application/index-engine.ts`).
- Incremental/changed-since paths depend on `git` subprocesses (`src/application/index-engine.ts`, `src/git-changed.ts`).
- Query path currently opens/closes DB per `executeQuery()` call (`src/application/query-engine.ts`).

## Prioritized performance findings (no functional changes)

## P0 quick wins

- **P0-1: `query_batch` connection churn**
  - Evidence: `executeQueryBatch()` maps to `executeQuery()`; `executeQuery()` opens/closes DB each statement.
  - Files: `src/application/query-engine.ts`, `src/application/tool-handlers.ts` (`handleQueryBatch`).
  - No-behavior-change fix: one readonly DB per batch, preserve per-item `{error}` semantics.
  - Confidence: high. Risk: low.

- **P0-2: repeated filesystem parsing in `--group-by owner|package`**
  - Evidence: `resolveBucketizer()` calls `loadCodeowners()` / `discoverWorkspaceRoots()` per query.
  - Files: `src/application/query-engine.ts`, `src/group-by.ts`.
  - No-behavior-change fix: cache bucketizers per root with conservative invalidation (mtime/TTL/manual reset).
  - Confidence: high. Risk: low.

- **P0-3: duplicate schema setup calls in index orchestration**
  - Evidence: `runCodemapIndex()` calls `createSchema(db)` up-front, then calls it again in incremental path.
  - File: `src/application/run-index.ts`.
  - No-behavior-change fix: call once per run path after mode resolution.
  - Confidence: high. Risk: low.

## P1 medium wins

- **P1-1: sync git subprocess overhead**
  - Evidence: multiple `spawnSync` calls per run for merge-base/diff/status/verify.
  - Files: `src/application/index-engine.ts`, `src/git-changed.ts`.
  - No-behavior-change fix: collapse git calls when possible and cache by `(root, ref, HEAD)` inside invocation scope.
  - Confidence: high. Risk: low-medium.

- **P1-2: worker scheduling + lifecycle overhead**
  - Evidence: fixed chunking across fixed worker count (`2..6`), workers created/terminated per chunk.
  - File: `src/worker-pool.ts`.
  - No-behavior-change fix: optional dynamic queue/pool reuse behind flag; keep default behavior until benchmarked.
  - Confidence: medium. Risk: medium.

- **P1-3: FTS worker payload amplification**
  - Evidence: when FTS enabled, full source copied into `parsed.content` in worker output.
  - Files: `src/parse-worker-core.ts`, `src/application/index-engine.ts`.
  - No-behavior-change fix: reduce cross-thread payload shape while preserving exact `source_fts` content.
  - Confidence: medium-high. Risk: high.

## P2 CI/dev-loop efficiency

- **P2-1: repeated dependency install in CI jobs**
  - Evidence: each major job runs local setup action; setup always runs `bun install --frozen-lockfile`.
  - Files: `.github/workflows/ci.yml`, `.github/actions/setup/action.yml`.
  - No-behavior-change fix: cache/install artifact strategy or job consolidation after timing comparison.
  - Confidence: high. Risk: low-medium.

- **P2-2: action startup installs detector package every run**
  - Evidence: `action.yml` executes `npm install --no-save ... package-manager-detector@1.6.0`.
  - File: `action.yml`.
  - No-behavior-change fix: vendor/bundle detector or pre-resolve tool in action bundle.
  - Confidence: high. Risk: low.

## Hotspot evidence snapshot (from codemap SQL)

- Largest indexed code files include:
  - `src/db.ts` (~53 KB)
  - `src/cli/cmd-query.ts` (~46 KB)
  - `src/application/tool-handlers.ts` (~28 KB)
  - `src/application/index-engine.ts` (~25 KB)
- Highest measured cyclomatic complexity includes:
  - `parseQueryRest` in `src/cli/cmd-query.ts` (`complexity=105`)
  - `main` in `src/cli/main.ts` (`68`)
  - `indexFiles` in `src/application/index-engine.ts` (`24`)
- `node:child_process` usage concentrated in:
  - `src/application/index-engine.ts`
  - `src/git-changed.ts`
  - `src/application/audit-worktree.ts`

## Risks / constraints to keep unchanged behavior

- Keep query output envelopes and error behavior identical (`--json`, grouped, summary, batch partial failures).
- Keep audit semantics unchanged (watch-aware skip logic, no implicit side effects).
- Preserve DB durability/perf posture (WAL + existing PRAGMAs) unless benchmark data proves change.
- Preserve worker parser outputs exactly (schema and downstream SQL expectations).

## Execution plan (tracer-bullet style)

1. **Slice A (P0-1):** refactor `executeQueryBatch` to single readonly DB connection + regression tests for mixed-success batches.
2. **Slice B (P0-2):** add request/process-local cache for bucketizer resolution + invalidation tests.
3. **Slice C (P0-3):** dedupe schema init calls in `runCodemapIndex` + timing smoke.
4. **Slice D (P1-1):** reduce incremental git subprocess count + benchmark before/after on `fixtures/minimal` and external tree.
5. **Slice E (CI):** prototype cache/consolidation in CI; compare duration and failure isolation.

Each slice: run project checks + benchmark deltas before next slice.

## Optional validation SQL (already used)

- Largest files:
  - `SELECT path,size,line_count,language FROM files ORDER BY size DESC LIMIT 20`
- Complexity hotspots:
  - `SELECT name,file_path,complexity,body_line_count,nesting_depth,param_count FROM symbols WHERE complexity IS NOT NULL ORDER BY complexity DESC, body_line_count DESC LIMIT 20`
- Import/process concentration:
  - `SELECT file_path,source FROM imports WHERE source='node:child_process' ORDER BY file_path`
