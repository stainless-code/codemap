---
name: codemap
description: Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding symbols, tracing dependencies, or auditing a project indexed by Codemap.
---

# Codemap — full reference

Query codebase structure via SQLite instead of scanning files. Use when exploring code, finding symbols, tracing dependencies, or auditing a project indexed by **Codemap**.

Examples below use **placeholders** (`'...'`, `getConfig`, `~/lib/api`) — the shipped content is project-agnostic. To customise, drop **sibling** files next to `.agents/rules/codemap.md` / `.agents/skills/codemap/SKILL.md` (e.g. `.agents/rules/my-team-conventions.md`); the bundled pointers stay codemap-managed and auto-refresh on `bun update @stainless-code/codemap`.

## Running queries

```bash
codemap query --json "<SQL>"            # JSON array (default for agents)
codemap query "<SQL>"                   # console.table (terminal-friendly)
codemap --root /path/to/project ...     # or CODEMAP_ROOT — index another tree
```

If `codemap` isn't on `PATH`: `npx @stainless-code/codemap`, `pnpm dlx @stainless-code/codemap`, `yarn dlx @stainless-code/codemap`, or `bunx @stainless-code/codemap` — same flags everywhere.

## Query output contract

- **Success** → `--json` prints a JSON array of row objects to stdout.
- **Failure** → stdout is a single `{"error": "<message>"}` and exit code is 1. Covers invalid SQL, database open errors, and bootstrap failures (config load, resolver setup) — not just SQL runtime errors. The CLI sets `process.exitCode` instead of `process.exit`, so piped stdout is not cut off.
- **No row cap.** Add `LIMIT` (and `ORDER BY`) in SQL when you need bounded output.
- When answering structural questions from the index, **ground the answer in the query rows** — do not invent or silently drop rows. Use `--json` for large or multi-column results.
