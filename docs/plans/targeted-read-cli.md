## Plan — `targeted-read-cli`

> Two sibling CLI verbs for precise reads:
>
> - **`codemap show <symbol>`** — returns metadata (`file_path:line_start-line_end` + `signature` + `kind`) for the symbol(s) matching the name. Pure ergonomic affordance over `SELECT … FROM symbols WHERE name = ?`.
> - **`codemap snippet <symbol>`** — same lookup, returns the source code text sliced from disk at `line_start..line_end`. Stale-file detection via the existing `files.content_hash` mechanism (verified — same primitive `cmd-validate.ts` already uses).
>
> Together they close the "agent wants to read this thing" loop without making the agent compose SQL.
>
> Adopted from [`docs/roadmap.md` § Backlog](../roadmap.md#backlog) ("Targeted-read CLI"). Builds on the symbols table that's been there since v0; no schema changes.

**Status:** Open — design pass; not yet implemented.
**Cross-refs:** [`docs/architecture.md` § CLI usage](../architecture.md#cli-usage) (`show` becomes a sibling of `query` / `audit` / `mcp`); the existing `query` recipe surface is unaffected.

---

## 1. Goal

Today an agent that wants to find the `runQueryCmd` symbol composes:

```bash
codemap query --json "SELECT name, file_path, line_start, line_end, signature FROM symbols WHERE name = 'runQueryCmd'"
```

After v1:

```bash
codemap show runQueryCmd
# → src/cli/cmd-query.ts:521-606  export async function runQueryCmd(opts: …): Promise<void>
```

The wins:

- **Tokens.** ~25-token CLI invocation vs ~80-token SQL. Multiplies across a session where the agent does this hundreds of times.
- **Agent affordance.** "Find this name" is the most common precise-read question agents ask; making it a one-step CLI removes a derivation step.
- **Composability stays.** `--json` returns the same row shape; agents that already know SQL can keep using `query` for cases `show` doesn't cover.

## 2. Surface

```text
codemap show <name> [--json] [--all] [--kind <kind>]
```

| Flag            | Default  | Behavior                                                                                                                           |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `<name>`        | required | Exact symbol name (case-sensitive). Maps to `WHERE name = '<name>'`.                                                               |
| `--json`        | off      | Emit the JSON envelope (array of row objects). Without it, terminal-friendly `path:line-line  signature` per row.                  |
| `--all`         | off      | Show every match. Default: error if more than one match (forces the agent to disambiguate via `--kind` or by being more specific). |
| `--kind <kind>` | unset    | Filter by `kind` column (`function`, `class`, `interface`, `const`, `type`, etc.). Useful when overloaded names exist.             |

**Output (terminal, single match):**

```
src/cli/cmd-query.ts:521-606
export async function runQueryCmd(opts: { … }): Promise<void>
```

**Output (terminal, multiple matches with `--all`):**

```
src/cli/cmd-query.ts:521-606
  export async function runQueryCmd(opts: { … }): Promise<void>

src/cli/cmd-query.test.ts:42-58
  function runQueryCmd(stub) { … }
```

**Output (`--json`):**

```json
[
  {
    "name": "runQueryCmd",
    "kind": "function",
    "file_path": "src/cli/cmd-query.ts",
    "line_start": 521,
    "line_end": 606,
    "signature": "export async function runQueryCmd(opts: { … }): Promise<void>"
  }
]
```

Same row shape as `SELECT name, kind, file_path, line_start, line_end, signature FROM symbols WHERE name = ?` — preserves the [plan § 4 uniformity](./agent-transports-NOTE.md) contract: any tool that's a thin wrapper over a CLI verb returns the verb's `--json` shape verbatim.

**Errors:**

- Unknown name → `{"error": "no symbol named '<name>'"}` on stdout (`--json`) or stderr otherwise; exit 1.
- Multiple matches without `--all` or `--kind` → `{"error": "<n> symbols named '<name>'; use --all to list them or --kind to narrow"}`.

## 3. Why one verb, not two

The roadmap entry hedged `codemap show <symbol> / codemap snippet <name>`. Two verbs would imply two return shapes — but both end up returning the same data (path + line range + signature). One verb (`show`) is enough; the optional `--all` / `--kind` flags cover the disambiguation cases that might have justified a second verb. If a real consumer later asks for "the actual code body" (file content sliced to line_start-line_end), that's a different feature (`codemap snippet` returns text content, not metadata) and can ship as a sibling later — but defer until asked.

## 4. Wiring

Mirrors the `cmd-context.ts` / `cmd-validate.ts` shape (small CLI verb that calls a pure engine helper):

- **`src/cli/cmd-show.ts`** — argv parser, help text, terminal-mode renderer, `runShowCmd` orchestrator
- **`src/cli/cmd-snippet.ts`** — same parser shape; renders source-text instead of metadata; `runSnippetCmd` orchestrator
- **`src/application/show-engine.ts`** — pure `findSymbolsByName({db, name, kind?, inPath?})` returning `SymbolMatch[]` (used by both `show` and `snippet`); plus `readSymbolSource({match, projectRoot})` returning `{source, stale}` (used by `snippet` only)
- **`src/cli/main.ts`** dispatch entries for `rest[0] === "show"` and `rest[0] === "snippet"`
- **`src/cli/bootstrap.ts`** — add `"show"` and `"snippet"` to the `validateIndexModeArgs` known-verbs list + help text

Reuses the `symbols` table directly — no new column, no new index (the existing `idx_symbols_name` already covers the lookup). For snippet, reuses `hashContent` from `src/hash.ts` + `toProjectRelative` from `src/cli/cmd-validate.ts` + `files.content_hash` for stale detection (verified — same pattern `cmd-validate.ts` already uses).

## 5. MCP integration

The MCP server (PR #35) auto-inherits via the same pattern as `audit` / `context` / `validate` — register `show` and `snippet` tools that call the engine helpers and return the JSON envelope. Per Q-1 below.

## 6. Tracer-bullet sequence

1. **Engine — show side** — `src/application/show-engine.ts` with `findSymbolsByName` + tests (returns rows for a name, optional kind filter, optional `inPath` prefix/exact filter, empty array for unknown). Pure; no CLI dependency.
2. **CLI — `codemap show`** — `src/cli/cmd-show.ts` (parser, help, terminal renderer, JSON renderer, disambiguation envelope, error UX) wired into `main.ts` + `bootstrap.ts`. Tests cover `--help` / unknown-name / single-match / multi-match envelope / `--kind` / `--in <path>` / `--json`.
3. **Engine — snippet side** — extend `show-engine.ts` with `readSymbolSource({match, projectRoot})` returning `{source: string, stale: boolean}`. Tests cover happy path, line-range slicing, missing file, stale-content (per Q-6 settled).
4. **CLI — `codemap snippet`** — `src/cli/cmd-snippet.ts` (same parser shape as show) + tests covering single/multi/stale.
5. **MCP tools** — `show({name, kind?, in?})` and `snippet({name, kind?, in?})` registered in `mcp-server.ts`; in-process SDK tests.
6. **Docs + agents** — `architecture.md § Show wiring`, glossary entries (`show`, `snippet`, `disambiguation envelope`), README CLI block, rule + skill across `.agents/` and `templates/agents/` (Rule 10), patch changeset, plan deletion (Rule 2).

Estimated total: ~1 day across 6 commits.

## 7. Open questions

### Settled

- **Q-1. MCP `show` tool?** ✅ **(a) Dedicated MCP tool.** Every CLI verb maps to an MCP tool today (set in PR [#35](https://github.com/stainless-code/codemap/pull/35)) — `show` joins the pattern. Discoverability is the killer feature: agents reading `tools/list` see `show` exists without needing the SQL schema. Token savings compound at scale (~50 tokens/call vs the equivalent `query({sql: …})` for agents doing precise reads hundreds of times per session). Cost is trivial (~25 LOC; reuses engine helper). Output shape stays uniform with the CLI's `show --json` per plan § 4.
- **Q-2. Multiple matches — error or list?** ✅ **(d.i) Always wrap in `{matches, disambiguation?}` envelope.** Single match → `{matches: [{...}]}`; multi-match → `{matches: [...], disambiguation: {n, by_kind, files, hint}}`. Agent reads `result.matches[0]` uniformly across both cases — one shape to learn, document, and test. Disambiguation envelope is forward-extensible (future `nearest_to_cursor`, `most_recently_modified`, `caller_count` fields land as additive keys with zero contract change). Original "error by default" framing was 2023-era — assumed agents would silently pick wrong from a list; today's frontier models reason fine over 2-5 candidates given context. Forcing the round-trip costs more than it saves. **Uniformity-contract requirement (verified against PR #35's pattern):** `codemap show <name> --json` MUST also wrap in the same envelope, NOT print a bare array. Otherwise CLI would print array and MCP would return envelope, violating the plan § 4 "every tool returns the JSON envelope its CLI counterpart's `--json` prints" contract. Rejected (a) error-by-default, (b) plain list (no future-extensibility), (c) first-match (silent wrong-row), (d.ii) polymorphic (`Array.isArray()` guard pollutes agent code).
- **Q-3. Exact match or substring/regex?** ✅ **Exact (`name = ?`) only.** Agents have the exact name in 95% of cases (read from stack traces, import statements, prior `query` results, code citations); "half-remembering" is a human pattern. Fuzzy under `show` would silently over-match on typos and inflate the disambiguation envelope. Exact-only fails fast with a recipe-aware error pointing at the escape hatch: `{"error": "no symbol named 'foo'. Try query with LIKE '%foo%' for fuzzy lookup."}` — agent immediately knows whether to fix the name or switch tools. Rejected (b) substring default — useful-when-correct vs noisy-when-typo is the wrong trade. Rejected (c) two-flag (`--like` opt-in) — every flag is cognitive load on the agent's tool-call planning; `query` already covers fuzzy with one MCP call; we don't need two ways to do the same thing. Keeps the `show` mental model sharp: "I know the name → I want to know where it lives."
- **Q-4. File-scope filter (`--in <path>`)?** ✅ **Ship `--in`.** Closes the loop with the disambiguation envelope (Q-2): the envelope already lists candidate files, so the agent's natural next move is "narrow by path" — that next move should be a flag add, not a tool switch to `query`. `--kind` solves "function vs const" but doesn't solve "this folder vs that folder" (the common ambiguity case). Cost is ~5 LOC. Match rule: if `<path>` ends with `/` or names a directory, treat as prefix (`AND file_path LIKE 'src/cli/%'`); else exact file match (`AND file_path = 'src/cli/cmd-query.ts'`). No glob characters — power users use `query`. **Path normalization via existing `toProjectRelative(projectRoot, p)` from `src/cli/cmd-validate.ts`** (verified — already handles leading `./`, trailing `/`, Windows backslash → POSIX) so `--in ./src/cli/` and `--in src/cli` both resolve identically. Forward-compatible: future `--in-package` / `--in-owner` would be sibling flags. Rejected (b) skip — wastes the disambiguation envelope's groundwork; forces tool-switch to `query` for what should be a parameter add.
- **Q-5. Snippet sibling — now or later?** ✅ **Ship `codemap snippet <name>` together with `show` in v1.** Architectural fact-check (verified against codebase): the lookup helper (`findSymbolsByName`) is shared with `show`; `readFileSync(abs, "utf8")` + `toProjectRelative` + `hashContent` (from `src/hash.ts`) + `files.content_hash` comparison is the literal pattern `cmd-validate.ts` already uses for stale detection — pure copy-paste reuse, no new architecture. Marginal cost: ~2-3 hours on top of `show` (~15 LOC slice helper, ~40 LOC `cmd-snippet.ts`, ~25 LOC MCP tool, tests). Splitting into a follow-up PR would duplicate the docs / changeset / Rule-10 mirror overhead — not a real saving. Snippet output: `{matches: [{...metadata, source: "...", stale?: true}]}` — additive field on Q-2's envelope, no shape divergence. Rejected (c) `--with-source` flag — Q-2's lesson against polymorphic envelopes applies; sibling verb is cleaner. Rejected (a) defer — duplicate-PR overhead exceeds the marginal-feature cost.
- **Q-6. Stale-file behavior for `snippet`?** ✅ **(1) Read + flag.** When `hashContent(readFileSync(abs))` differs from `files.content_hash`, return the source content from disk with `stale: true` on the match; agent decides whether to act on possibly-shifted line ranges. Agent-first reasoning: gives the agent data + warning, preserves their autonomy (e.g. "I want stale to compare with what changed"). Bundled `templates/agents/skills/codemap/SKILL.md` teaches the next step ("if `stale: true`, the line range may have shifted — verify with `query` or re-index before acting"). Rejected (2) refuse — hostile; forces 3 round-trips (snippet → error → reindex → snippet) for content that's already on disk. Rejected (3) auto-reindex — hidden side-effect from a read tool violates the read/write separation we've kept clean across PRs #33 / #35 / #37; latency spike on every snippet call against a touched file; destroys the "I want stale" use case. Implementation: ~5 LOC (one hash compare + one boolean field).

### Still open

_None — all 6 questions settled. Ready to start tracer 1._

## 8. Non-goals (v1)

- **Cross-symbol resolution** (e.g. `codemap show MyClass.method`) — not what the symbols table indexes today; would need a new lookup path. Use `query` with `parent_name = 'MyClass'` for now.
- **Fuzzy matching** — `query` already covers this with `LIKE` patterns.
- **Output sorting controls** — current default `ORDER BY file_path ASC, line_start ASC`. If a consumer wants different, use `query`.
- **`--with-source` flag on `show`** — rejected per Q-5; sibling `snippet` verb is cleaner than a polymorphic envelope.
- **Auto-reindex on snippet stale** — per Q-6 (pending); agent gets `stale: true` and decides; codemap doesn't trigger side-effects from a read tool.
- **Glob characters in `--in <path>`** — `--in src/**/*.ts` not supported; use `query` with `LIKE` for that pattern. Keeps `show`'s parser simple and unambiguous.

## 9. References

- Roadmap entry: [`docs/roadmap.md` § Backlog](../roadmap.md#backlog).
- Symbols table shape: [`docs/architecture.md` § Schema](../architecture.md#schema).
- Doc lifecycle: this file follows the **Plan** type per [`docs/README.md` § Document Lifecycle](../README.md#document-lifecycle) — **delete on ship**, lift the canonical bits into `architecture.md` per Rule 2.
