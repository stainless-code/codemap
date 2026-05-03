---
"@stainless-code/codemap": minor
---

`codemap impact <target>` — symbol/file blast-radius walker. Replaces hand-composed `WITH RECURSIVE` queries that agents struggle to write reliably with a single verb that walks the calls / dependencies / imports graphs (callers, callees, dependents, dependencies). Depth- and limit-bounded, cycle-detected.

**Three transports, one engine:**

- **CLI:** `codemap impact <target> [--direction up|down|both] [--depth N] [--via dependencies|calls|imports|all] [--limit N] [--summary] [--json]`
- **MCP tool:** `impact` (registered alongside `show` / `snippet`)
- **HTTP:** `POST /tool/impact`

All three dispatch the same pure `findImpact` engine in `application/impact-engine.ts` per the post-PR #41 layering — adding tools never duplicates business logic.

**Decisions worth knowing:**

- **Target auto-resolution.** Contains `/` or matches `files.path` → file target; otherwise symbol (case-sensitive, exact). Symbol targets walk `calls`; file targets walk `dependencies` + `imports` (`resolved_path` only). Mismatched explicit `--via` choices land in `skipped_backends` (no error — agent sees why their selection yielded fewer rows than expected).
- **Cycle detection.** SQLite has no native cycle predicate; we materialise a comma-bounded path string per row and `instr` it to break re-entry. Bounded depth + `--limit` (default 500) keep cyclic graphs cheap regardless. `--depth 0` walks unbounded but stays cycle-detected and limit-capped.
- **Termination classification.** `summary.terminated_by`: `limit` > `depth` > `exhausted`. CI gates can branch on it.
- **`--summary` shape.** Trims the `matches` array but preserves `summary.nodes` — the `jq '.summary.nodes'` consumption pattern still works.
- **No SARIF / annotations.** Impact rows are graph traversals, not findings — wrong shape for those formats.

**Engine sketch:** one `WITH RECURSIVE` query per (direction, backend) combo, JS-side merge + dedup by `(direction, kind, name?, file_path)` keeping the shallowest depth, then `summary.by_kind` + `terminated_by` classification.

Plan: PR #49 (merged). Implementation: PR #50.
