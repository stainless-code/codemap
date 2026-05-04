# Why Codemap

**Index:** [README.md](./README.md) · **Design:** [architecture.md](./architecture.md)

## The Problem

AI coding agents (Cursor, Copilot, Windsurf, etc.) discover code by scanning files at runtime — globbing directories, reading file contents, grepping for patterns, then reading more files to follow leads. For a codebase of this size, every discovery question triggers:

- **3-5 tool calls** (Glob → Read → Grep → Read → ...) per question
- **9+ MB of source** loaded into context per scan
- **~2.3 million tokens** consumed per full-codebase read (at ~4 bytes/token)
- **False positives** from regex that require additional reads to disambiguate

This burns context window, wastes tokens, slows response time, and produces less accurate results.

## What Codemap is not

Codemap is intentionally narrow. It is **not**:

- **Full-text search** — use `ripgrep` / your IDE for raw string queries on file bodies.
- **A language server (LSP)** — no rename, no go-to-definition wired to your editor, no hover types.
- **An AI agent** — Codemap does not reason, decide, or generate. Agents call Codemap; Codemap does not call agents.
- **A static analyzer** — no dead-code detection, duplication detection, complexity scoring, or boundary enforcement (those are different products — e.g. `knip`, `jscpd`).
- **A semantic / embedding index** — no vector search, no PageRank summarization, no "what's relevant" inference.
- **A replacement for reading code** — the index returns paths, line ranges, signatures; the agent still reads the snippets it needs.

What Codemap **is**: a deterministic, AST-backed SQLite index of structural facts (symbols, imports, exports, components, calls, dependencies, CSS tokens, markers) that an agent can query in **one SQL round-trip** instead of scanning the tree.

## The Solution

A pre-built SQLite index (`.codemap/index.db`) that extracts and structures code metadata at index time. Agents query it with SQL instead of scanning files. Timings, scenarios, and methodology: [benchmark.md](./benchmark.md).

## Bundled CLI recipes

**Shipped SQL** for fan-out, fan-in, index stats, markers, components, etc. — **`codemap query --recipe`**, **`--json`**, **`--recipes-json`**, **`--print-sql`**, and examples: [README.md § CLI](../README.md#cli) (canonical). Bundled agent templates default examples to **`codemap query --json`**. **`fan-out-sample`** vs **`fan-out-sample-json`**: same ranking; JSON1 vs **`GROUP_CONCAT`** — see readme or **`codemap query --help`**. Agent-oriented SQL and schema: bundled [**`SKILL.md`**](../.agents/skills/codemap/SKILL.md) (this repo) / **`codemap agents init`** templates for consumers.

## Speed Gains

### Headline pattern

Indexed queries stay **sub-millisecond** per scenario on typical trees; the traditional path scales with **how many files** it must read and scan. On a large application, overall speedups on the order of **tens to hundreds ×** are common for structural questions; exact ratios depend on the project and hardware. Re-run the benchmark after major changes or when pointing `--root` at a different repo.

### Why even “small” wins matter

The tightest scenarios are those where the traditional path only touches a small file set; the index still avoids repeated filesystem walks and keeps answers in one SQL round-trip. Wider scenarios widen the gap — see [architecture.md § SQLite Performance Configuration](./architecture.md#sqlite-performance-configuration) for PRAGMAs and indexes.

## Token Efficiency

This is the real value for AI agents. Speed matters, but token waste is the dominant cost.

### Per-Question Savings

Traditional cost **depends on the question**: scanning all `app/**/*.{ts,tsx}` is ~9 MB (~2.3M tokens at ~4 bytes/token). A full benchmark pass on a **large** tree can read tens of megabytes on the traditional side — see the script’s “Token impact estimate” footer. Indexed queries return only result rows (typically a few KB at most).

**Order-of-magnitude**: indexed discovery is vastly cheaper in tokens than “read every matching file” workflows for large trees.

### Across a Typical Session

Token cost compounds across a session. The savings are not "any single lookup" — they are "every lookup, multiplied". Concrete shapes:

| Scenario                                                     | Without Codemap                                         | With Codemap                                          | Savings |
| ------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------- | ------- |
| **Single symbol lookup** ("where is `UserService` defined?") | 1 Glob + 1–2 Reads to disambiguate ≈ **0.5–1K tokens**  | 1 SQL row → file/line range ≈ **~150 tokens**         | ~70–85% |
| **Trace dependents** ("who imports `~/utils/date`?")         | Grep + read 5–10 files to resolve aliases ≈ **30–100K** | 1 SQL row set ≈ **~500 tokens**                       | ~95%    |
| **10-file refactor session**                                 | 10× full file reads + grep traces ≈ **100–300K**        | 10× targeted SQL + 10× line-range reads ≈ **~10–25K** | ~85–90% |
| **50-turn agent session** (mixed discovery + reads)          | ≈ **500K – 1M+ tokens**                                 | ≈ **30–60K tokens**                                   | ~90%+   |
| **Tool calls per discovery question**                        | 3–5 (Glob → Read → Grep → Read → …)                     | 1 (`codemap query`)                                   | 60–80%  |

> Token estimates assume **~4 bytes/token** and a medium TS codebase. Actual numbers vary by repo. Run `bun run benchmark:query` against your tree for concrete values; methodology in [benchmark.md § Query stdout](./benchmark.md#query-stdout-table-vs-json-benchmarkquery).

### Real-World Context Window Impact

Most AI models have context windows of 128K-200K tokens. Reading 9 MB of source consumes **~2.3M tokens** — that's **11-18× the entire context window**. In practice, AI agents read in chunks, but each chunk displaces earlier context, causing:

- **Context eviction** — earlier conversation, instructions, and results get pushed out
- **Repeated reads** — the agent re-reads files it already saw because they fell out of context
- **Shallow exploration** — the agent stops searching early to preserve context budget

The index eliminates this for structural questions. A query returning 50 matching rows is ~500 tokens — a tiny fraction of a 200K context window.

## Accuracy Gains

Structured parsing produces better results than naive regex for many questions:

| Scenario     | Index                          | Traditional (naive regex)      |
| ------------ | ------------------------------ | ------------------------------ |
| CSS tokens   | Structured rows                | Raw `--var` matches (noise)    |
| TODO markers | All configured extensions      | Depends on glob scope          |
| Dependencies | Resolved edges (with tsconfig) | Import text without resolution |
| Components   | JSX/TSX heuristic + hooks      | Export-line regex (imprecise)  |

The index uses **AST-level parsing** where applicable — see [architecture.md § Parsers](./architecture.md#parsers) for how each file type is parsed.

## Structural Queries Not Possible with File Scanning

Some queries are trivial with the index but impractical (or slow) with traditional scanning:

| Query                                | Index (1 SQL)                                                                          | Traditional                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| "What depends on `utils/date.ts`?"   | `SELECT from_path FROM dependencies WHERE to_path LIKE '%utils/date%'`                 | Grep for import paths → resolve aliases manually → read tsconfig → follow re-exports |
| "Components using `useQuery` hook"   | `SELECT name, file_path FROM components WHERE hooks_used LIKE '%useQuery%'`            | Grep `useQuery` → filter to component files → disambiguate                           |
| "Heaviest files by dependency count" | `SELECT from_path, COUNT(*) AS n FROM dependencies GROUP BY from_path ORDER BY n DESC` | Scan every file for imports → approximate without resolver                           |
| "Exports from a specific module"     | `SELECT name, kind FROM exports WHERE file_path = '...'`                               | Read the file → parse mentally → identify exports vs internal                        |
| "All CSS animations in the project"  | `SELECT name, file_path FROM css_keyframes`                                            | Grep `@keyframes` across CSS files → parse names                                     |

## Codemap vs alternatives

Other "AI-friendly code intelligence" tools occupy different points in the design space. Each one is solving a different problem:

| Axis              | **Codemap**                           | [fallow](https://github.com/fallow-rs/fallow)                 | [Aider RepoMap](https://aider.chat) | LSP servers                 |
| ----------------- | ------------------------------------- | ------------------------------------------------------------- | ----------------------------------- | --------------------------- |
| Primary thesis    | Query structure with **SQL**          | Detect dead code / dupes / complexity                         | Summarize repo into a context blob  | Per-edit semantic helpers   |
| Output shape      | Result rows from a SQL query          | SARIF / JSON findings, fix `actions`                          | Markdown / token-budgeted text      | LSP messages over stdio     |
| Decides relevance | The agent (via SQL)                   | The tool (via static rules)                                   | The tool (PageRank-style)           | The editor                  |
| Scope             | Structural facts (definitions, edges) | Static analysis verdicts                                      | Whole-repo summary                  | One file at a time          |
| Storage           | Local SQLite (`.codemap/index.db`)    | In-process; emits findings                                    | In-prompt context                   | In-process index            |
| Token cost        | Per-query; tiny result rows           | Per-run; finding lists                                        | Upfront; bounded by token budget    | None (editor-side)          |
| Best for          | Targeted "where / what / who" lookups | "Did this PR introduce dead code / dupes / complexity drift?" | First-touch context priming         | Editor-time refactoring     |
| Worst for         | Whole-file semantic understanding     | Granular structural lookups (different shape)                 | Targeted line-range reads           | Cross-cutting graph queries |

**Why this matters:** Codemap deliberately **doesn't try to be smart**. Other tools predict what context an agent will need; Codemap lets the agent decide and just makes each decision cheap. The same agent can use Codemap **and** fallow **and** an LSP — they don't compete for the same slot.

For more on what Codemap deliberately does **not** do, see [What Codemap is not](#what-codemap-is-not) above and [docs/roadmap.md § Non-goals](./roadmap.md#non-goals-v1).

## Cost Summary

| Dimension               | Without Index           | With Index                                    | Improvement                        |
| ----------------------- | ----------------------- | --------------------------------------------- | ---------------------------------- |
| **Speed**               | scales with files read  | sub-ms SQL for structural queries             | large on big trees                 |
| **Tokens (large tree)** | multi-MB reads possible | tiny result sets from SQL                     | See [benchmark.md](./benchmark.md) |
| **Tool calls/question** | 3-5                     | 1                                             | fewer                              |
| **Accuracy**            | Regex (varies)          | AST + resolver where applicable               | Higher precision                   |
| **Index build**         | —                       | amortized; see [benchmark.md](./benchmark.md) | —                                  |
| **Storage**             | —                       | small SQLite file on disk                     | Negligible                         |
