---
"@stainless-code/codemap": minor
---

`codemap ingest-coverage --runtime <dir>` — V8 runtime coverage parser. Reads a `NODE_V8_COVERAGE=...`-style directory (one or more `coverage-<pid>-<ts>-<seq>.json` files) and dispatches to the existing `upsertCoverageRows` core through a new `ingestV8` parser. Each script's byte-offset ranges are converted to per-line hit counts via innermost-wins range walking (smaller, more specific ranges override the function-as-a-whole count — matches V8's documented semantics). Skips non-`file://` URLs (Node internals, `evalmachine.<anonymous>`); merges duplicate-URL scripts across dumps so multi-process test runs don't inflate `total_statements`.

Format auto-detection is unchanged for files (`.json` → istanbul, `.info` → lcov, directory of either → probe both with explicit-error on ambiguity); `--runtime` is the explicit opt-in for V8 directories. The `coverage` table schema doesn't move — V8 rows write through the same `(file_path, name, line_start, hit_statements, total_statements, coverage_pct)` projection, so every existing JOIN (`untested-and-dead`, `files-by-coverage`, `worst-covered-exports`) works unchanged.

Useful for "delete cold code with stronger evidence" agent flows: production-style traces from real test runs feed the same recipes that consume Istanbul/LCOV today. **Local-only — SaaS aggregation explicitly out of scope** (different product class). The parser stays in-process; no aggregation server, no upload primitive. New `format: "v8"` arm on the result envelope; existing `"istanbul" | "lcov"` consumers don't break.

Engine module: `application/coverage-engine.ts` (added `ingestV8`, `V8ScriptCoverage`, `V8FunctionCoverage`, `V8CoveragePayload` exports). CLI module: `cli/cmd-ingest-coverage.ts` (added `--runtime` flag, `resolveV8Directory` helper that reads every top-level `*.json` in the directory and merges their `result` arrays). Pure additive — `--json` output gains `"format": "v8"` as a possible value.
