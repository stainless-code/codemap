# `codemap impact` — symbol / file blast-radius walker

> **Status:** in design (no code) · **Backlog:** none yet — this plan is the introduction. Delete this file when shipped (per [`docs/README.md` Rule 3](../README.md)).

## Goal

Replace the "agent composes a `WITH RECURSIVE` CTE by hand" tax with one verb. The most common refactor agent loop today is "find symbol X → find callers of X → find callers of callers → read each one → edit." Steps 2-3 require recursive CTEs that most agents can't write reliably; the ones that can do so without depth limits and bury themselves in cyclic graphs.

`codemap impact <target>` is to the dependency / calls graph what `codemap show` (PR #39) was for symbol lookup: replaces "compose `SELECT … WHERE name = ?` by hand" with one verb.

## Why this is the maximum agent-value next move

Codemap's current agent-friction surface (post-PR #47):

| Friction                                      | Status                                     | This plan                     |
| --------------------------------------------- | ------------------------------------------ | ----------------------------- |
| "Is the index stale?"                         | Solved by `--watch` (PR #47)               | —                             |
| "Where is X defined / what does X look like?" | Solved by `show` / `snippet` (PR #39)      | —                             |
| "What changed since Y?"                       | Solved by `--changed-since` (PR #26)       | —                             |
| **"What's the blast radius if I change X?"**  | **Forces agent to compose recursive SQL**  | **`codemap impact <target>`** |
| "What's the public API surface?"              | Partially covered by `barrel-files` recipe | Out of scope                  |
| "When did X arrive in the codebase?"          | Requires `git log -L` shell-out            | Out of scope (consider later) |

Agents in refactor sessions today follow a 5-7 query pattern; `impact` collapses 3 of those queries into one round-trip. Higher-leverage than the alternatives considered (see [§ Alternatives](#alternatives)).

## Sketched API

CLI surface (mirrors existing `show` / `snippet` patterns):

```bash
codemap impact <target>                       # symbol name OR file path
  [--direction up|down|both]                  # callers / callees / both — default `both`
  [--depth N]                                 # default 3; 0 = unbounded (cycle-detected)
  [--via dependencies|calls|imports|all]      # which graph(s) to walk — default `all`
  [--limit N]                                 # cap total result rows (default 500)
  [--summary]                                 # collapse to {nodes, max_depth, by_kind, terminated_by}
  [--json]                                    # JSON envelope; absent = terminal table

# Examples
codemap impact handleQuery
codemap impact src/db.ts --direction up                        # what depends on db.ts
codemap impact handleAudit --depth 1 --via calls               # direct callers via calls table only
codemap impact runWatchLoop --json --summary                   # one-line blast-radius score
codemap impact 'src/cli/' --direction up --json                # everything that reaches anything in src/cli/
```

MCP tool + HTTP `POST /tool/impact` for free (the now-standard `tool-handlers.ts` shape).

## Output envelope

Single match (`{matches: [{...}]}`) shape per the existing `show` / `snippet` precedent. Each match is a node in the impact graph:

```jsonc
{
  "target": {
    "kind": "symbol",
    "name": "handleQuery",
    "matched_in": ["src/application/tool-handlers.ts"],
  },
  "direction": "both",
  "via": ["calls", "dependencies", "imports"],
  "depth_limit": 3,
  "matches": [
    {
      "depth": 1,
      "edge": "called_by",
      "kind": "symbol",
      "name": "registerQueryTool",
      "file_path": "src/application/mcp-server.ts",
      "line_start": 117,
    },
    {
      "depth": 1,
      "edge": "calls",
      "kind": "symbol",
      "name": "executeQuery",
      "file_path": "src/application/query-engine.ts",
      "line_start": 72,
    },
    {
      "depth": 2,
      "edge": "called_by",
      "kind": "file",
      "file_path": "src/application/http-server.ts",
      "via_caller": "registerQueryTool",
    },
    // ... up to --limit ...
  ],
  "summary": {
    "nodes": 47,
    "max_depth_reached": 3,
    "by_kind": { "symbol": 31, "file": 16 },
    "terminated_by": "depth", // "depth" | "limit" | "exhausted" | "cycle"
  },
}
```

`--summary` returns just the `target` + `summary` keys. Single-target single-row vs multi-target (e.g. when `<target>` matches multiple symbols by exact name) handled the same way `show` does it: `disambiguation` block when `target` resolves to >1 candidate.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Target resolution.** Args parsed in this order: literal file path (contains `/` or matches an indexed `files.path`) → symbol name (exact, case-sensitive). On ambiguity (symbol name resolves to >1 row), return the same `disambiguation` envelope `show` does — agent narrows with `--in <path>` (added in v1.x if asked).                                 |
| D2  | **Graph backends.** Three SQL relations carry the graph: `dependencies(from_path, to_path)` (file-level, resolved), `calls(file_path, caller_name, callee_name)` (symbol-level), `imports(file_path, resolved_path)` (file-level, optional `is_type_only` filter). `--via all` walks all three; named values walk one.                                         |
| D3  | **Direction.** `up` = callers / dependents (incoming edges). `down` = callees / dependencies (outgoing edges). `both` = union with disjoint depth counters per direction (so a node 2 hops up + 3 hops down lands at depth 2 in the up tree, depth 3 in the down tree, deduped by `(name, file_path, direction)`).                                             |
| D4  | **Depth + termination.** Default depth 3 (covers most refactor questions; sub-second on 50k-symbol indexes). `--depth 0` = unbounded. Hard `--limit` (default 500 rows) prevents runaway. Cycle detection via visited-set: re-entering a node truncates the branch. Result envelope's `terminated_by` says how the walk ended.                                 |
| D5  | **Implementation.** Pure SQL `WITH RECURSIVE` per direction per backend (≤ 6 CTEs in the worst case). No JS-side recursion. Engine emits one query per `--via` × direction combo, then merges + dedups in pure JS. Pure transport-agnostic engine (`application/impact-engine.ts`); CLI / MCP / HTTP all wrap it.                                              |
| D6  | **Cycle-detection cost.** SQLite `WITH RECURSIVE` doesn't natively detect cycles; we materialize a path string and check `instr(path, ',' \|\| node \|\| ',') = 0` per row. Approximation: bounded depth + `LIMIT` keeps even cyclic graphs cheap. Real cycle accounting reported via `terminated_by: "cycle"` only when we genuinely break the chain.         |
| D7  | **Output shape uniformity.** Same `{matches, disambiguation?}` envelope `show` / `snippet` use. JSON-via-CLI, MCP `query`-shape (text content), HTTP `application/json`. SARIF / annotations not supported (impact rows are graph traversals, not findings — `--format sarif` rejected at parse time with the existing `formatIncompatibility` guard pattern). |
| D8  | **Kind tagging on matches.** Each row carries `kind: "symbol" \| "file"` so the renderer can surface them differently. Symbols get `name` + `file_path` + `line_start`; files get `file_path` only. The `edge` field tells you which relation got us there: `calls` / `called_by` / `depends_on` / `depended_on_by` / `imports` / `imported_by`.               |
| D9  | **`--summary` shape.** Always wraps the node count + termination state — useful for CI gates (`codemap impact <crit-symbol> --summary --json \| jq '.summary.nodes'`) and for `--save-baseline` integration (Tracer 5 — diff impact-counts over time).                                                                                                         |
| D10 | **No fuzzy target.** Exact name only (case-sensitive) — same precedent `show` set. Fuzzy lookup is `query` with `LIKE`. Keeping `impact` deterministic + cheap.                                                                                                                                                                                                |

## Tracers

| #   | Slice                                                                                                                                                                                                                                                                                                                                                                                         | Acceptance                                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `application/impact-engine.ts` — pure walker. `findImpact({db, target, direction, via, depth, limit})` returns `{nodes, terminated_by}`. Recursive SQL per backend; pure JS dedup + envelope build. Unit tests against fixture DB (cycle, depth cap, limit cap, multi-via merge, file vs symbol target).                                                                                      | All edge cases covered: 0 hits, 1 hit, cycles, depth termination, limit termination                                               |
| 2   | `cmd-impact.ts` — CLI verb + parser (mirrors `cmd-show.ts` shape). `--direction` / `--depth` / `--via` / `--limit` / `--summary` / `--json` / `--help`. Wired into `main.ts` + `bootstrap.ts` + `printCliUsage`. Per-tool Zod schema in `tool-handlers.ts`.                                                                                                                                   | `bun src/index.ts impact handleQuery` boots, returns terminal table; `--json` returns the envelope; `--summary` returns the count |
| 3   | MCP `impact` tool — register in `tool-handlers.ts` (`handleImpact`) + `mcp-server.ts` wrapper. Same args.                                                                                                                                                                                                                                                                                     | MCP integration test confirms tool/list includes `impact`, callTool returns the envelope                                          |
| 4   | HTTP `POST /tool/impact` — auto-wired via the existing dispatcher in `http-server.ts` (one switch arm).                                                                                                                                                                                                                                                                                       | HTTP integration test: POST with `{target: ...}` returns 200 + envelope; missing target → 400; `--summary` echoes through         |
| 5   | Docs sync (README, `architecture.md` § Impact wiring, glossary `impact`, agent rule + skill in `.agents/` + `templates/agents/` per Rule 10) + minor changeset + delete this plan. Optional: `recipes/blast-radius.sql` + `.md` (project-recipe-shaped wrapper around `impact` for common shapes — e.g. "show me the top-10 highest-fan-in symbols, with their full impact tree at depth 2"). | All docs updated; plan deleted                                                                                                    |

## Performance considerations

- Default depth 3 + limit 500 caps walk size. Even on a 100k-symbol index, three `WITH RECURSIVE` queries return in tens of ms.
- The `dependencies` graph is small (one row per resolved edge); the `calls` table is the biggest (one row per call site). For a refactor target with 1000 callers, depth 1 is instant; depth 3 might enumerate tens of thousands of nodes — `LIMIT 500` truncates with `terminated_by: "limit"`.
- Bounded depth means we don't need a full transitive closure precomputation. If perf becomes a problem on huge monorepos, a `--cache` opt could materialize a closure table — defer to a real measurement.

## Alternatives considered (and rejected for now)

| Candidate                                                                                                           | Why not first                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `codemap inspect <file>` (kitchen-sink envelope: every symbol, export, import, dep, marker, component for one file) | Smaller win — replaces 5-7 easy queries with 1, but each individual query is already easy. Less leverage than impact           |
| Symbol-level provenance (`defined_at_commit` column on `symbols`)                                                   | Cheap schema bump; useful for "when did X arrive?", but external `git log -L` works today and adds a runtime dependency on git |
| `codemap blame <symbol>` (git history per symbol at query time)                                                     | Adds git as runtime dep + slow (seconds per call); use external `git log -L` for now                                           |
| Composable recipe pipelines                                                                                         | `query_batch` already covers this on MCP                                                                                       |
| Per-row source snippets in recipe results                                                                           | Saves one round-trip per row, but agents already cache snippet results across a session                                        |
| Agent observability / "you queried X times" telemetry                                                               | Doesn't change agent capability, just gives them self-data — secondary                                                         |
| Framework plugin layer (C.9 from fallow.md)                                                                         | Months out; closes the dead-code false-positive gap structurally but huge surface                                              |
| Static coverage ingestion (C.11 from fallow.md)                                                                     | Narrow scope — unlocks "unused exports with 0% coverage" for one specific workflow                                             |

## Out of scope

- **Fuzzy target matching.** Exact name only; agents use `query` with `LIKE` for fuzzy lookup.
- **Non-`--via` filters** (e.g. only TypeScript symbols, only certain kinds). The `query` SQL surface still wins for "I need a custom predicate" — `impact` is "I want the standard graph walk."
- **SARIF / annotations output.** Impact rows are graph traversals, not findings.
- **Edge weighting / centrality / PageRank-style scoring.** That's the visualization non-goal in disguise — leave to consumers who pipe `--json` through their own analyzer.
- **Cross-file symbol resolution.** If two files export `foo`, `codemap impact foo` returns multiple targets (per `show`'s `disambiguation` shape) — agent narrows with `--in`. Not "magically pick the right one based on import graph context."
- **Path-style target globs** (`src/cli/**`). Use `query` with `LIKE` to enumerate, then `impact` per file. Glob support is a v1.x addition if asked.
