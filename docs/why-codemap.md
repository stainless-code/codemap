# Why Codemap

## The Problem

AI coding agents (Cursor, Copilot, Windsurf, etc.) discover code by scanning files at runtime — globbing directories, reading file contents, grepping for patterns, then reading more files to follow leads. For a codebase of this size, every discovery question triggers:

- **3-5 tool calls** (Glob → Read → Grep → Read → ...) per question
- **9+ MB of source** loaded into context per scan
- **~2.3 million tokens** consumed per full-codebase read (at ~4 bytes/token)
- **False positives** from regex that require additional reads to disambiguate

This burns context window, wastes tokens, slows response time, and produces less accurate results.

## The Solution

A pre-built SQLite index (`.codemap.db`) that extracts and structures code metadata at index time. Agents query it with SQL instead of scanning files. Build and query timings: [benchmark.md](./benchmark.md).

## Speed Gains

Measured via `bun src/benchmark.ts` — see [benchmark.md](./benchmark.md) for full methodology.

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

A typical AI agent session involves 10-20 discovery questions (finding definitions, tracing imports, checking dependencies). At traditional rates on a large app:

| Metric                    | Traditional | Indexed     | Savings    |
| ------------------------- | ----------- | ----------- | ---------- |
| Token cost (10 questions) | very large  | ~5K tokens  | **~99%+**  |
| Token cost (20 questions) | very large  | ~10K tokens | **~99%+**  |
| Tool calls per question   | 3-5         | 1           | **60-80%** |

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

## Cost Summary

| Dimension               | Without Index           | With Index                                    | Improvement                        |
| ----------------------- | ----------------------- | --------------------------------------------- | ---------------------------------- |
| **Speed**               | scales with files read  | sub-ms SQL for structural queries             | large on big trees                 |
| **Tokens (large tree)** | multi-MB reads possible | tiny result sets from SQL                     | See [benchmark.md](./benchmark.md) |
| **Tool calls/question** | 3-5                     | 1                                             | fewer                              |
| **Accuracy**            | Regex (varies)          | AST + resolver where applicable               | Higher precision                   |
| **Index build**         | —                       | amortized; see [benchmark.md](./benchmark.md) | —                                  |
| **Storage**             | —                       | small SQLite file on disk                     | Negligible                         |
