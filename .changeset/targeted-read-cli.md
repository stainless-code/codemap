---
"@stainless-code/codemap": minor
---

feat(show + snippet): targeted-read CLI verbs + MCP tools

Two sibling verbs that close the "agent wants to read this thing" loop
without composing SQL:

- **`codemap show <name>`** — returns metadata
  (`file_path:line_start-line_end` + `signature` + `kind`) for the
  symbol(s) matching the exact name (case-sensitive).
- **`codemap snippet <name>`** — same lookup; each match also carries
  `source` (file lines from disk), `stale` (true when content_hash
  drifted since indexing), `missing` (true when file is gone).

Both share the same flag set (`--kind <k>` filter, `--in <path>` file
scope — directory prefix or exact file, normalized via the existing
`toProjectRelative` helper for cross-platform consistency).

Output is the agent-friendly `{matches, disambiguation?}` envelope on
both CLI `--json` and MCP responses (uniformity contract per the MCP
plan). Single match → `{matches: [{...}]}`; multi-match adds
`disambiguation: {n, by_kind, files, hint}` — structured aids so the
agent narrows without scanning every row. Forward-extensible (future
`nearest_to_cursor` / `most_recently_modified` / `caller_count` fields
land as additive keys).

MCP tools `show` and `snippet` register parallel to the CLI verbs and
auto-inherit the same envelope shape.

Stale-file behavior on snippet: `source` is always returned when the
file exists; `stale: true` is metadata the agent reads. No refusal,
no auto-reindex side-effects — read tool stays read-only.

Architecturally: pure transport-agnostic engine in
`src/application/show-engine.ts` (mirrors the cmd-_ ↔ _-engine seam
from PRs #33 / #35 / #37); thin CLI verbs in `src/cli/cmd-show.ts`

- `src/cli/cmd-snippet.ts`. Reuses `findSymbolsByName`, `hashContent`
  (from `src/hash.ts`), `toProjectRelative` (now exported from
  `cmd-validate.ts`), and `files.content_hash` — same primitives the
  existing `validate` command already uses for stale detection. No
  schema change.

Test coverage: 19 engine tests (lookup variants, line slicing, stale
detection, missing files), 13 cmd-show parser/envelope tests, 11
cmd-snippet parser/envelope/stale tests, 8 in-process MCP integration
tests via `@modelcontextprotocol/sdk`'s `InMemoryTransport`.
