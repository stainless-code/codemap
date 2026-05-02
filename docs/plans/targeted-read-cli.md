## Plan — `targeted-read-cli`

> One-step CLI verb for "tell me where this symbol is" — `codemap show <symbol>` returns `file_path:line_start-line_end` + `signature` for the symbol(s) matching the name. Pure ergonomic affordance over `SELECT … FROM symbols WHERE name = ?`; agents stop having to compose SQL for trivial precise-read questions.
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
- **`src/application/show-engine.ts`** — pure `findSymbolsByName({db, name, kind?})` returning `SymbolMatch[]`
- **`src/cli/main.ts`** dispatch entry for `rest[0] === "show"`
- **`src/cli/bootstrap.ts`** — add `"show"` to the `validateIndexModeArgs` known-verbs list + help text

Reuses the `symbols` table directly — no new column, no new index (the existing `idx_symbols_name` already covers the lookup).

## 5. MCP integration

The MCP server (PR #35) auto-inherits via the same pattern as `audit` / `context` / `validate` — register a `show` tool that calls `findSymbolsByName` and returns the JSON envelope. Per Q-1 below.

## 6. Tracer-bullet sequence

1. **Engine** — `src/application/show-engine.ts` with `findSymbolsByName` + tests (returns rows for a name, optional kind filter, empty array for unknown). Pure; no CLI dependency.
2. **CLI verb** — `src/cli/cmd-show.ts` (parser, help, terminal renderer, JSON renderer, error UX) wired into `main.ts` + `bootstrap.ts`. Tests cover `--help` / unknown-name / multiple-match-error / `--all` / `--kind` / `--json`.
3. **MCP tool** — `show({name, kind?, all?})` registered in `mcp-server.ts`; in-process SDK test.
4. **Docs + agents** — `architecture.md § Show wiring`, glossary entry, README CLI block, rule + skill across `.agents/` and `templates/agents/` (Rule 10), patch changeset, plan deletion (Rule 2).

Estimated total: ~half day across 4 commits.

## 7. Open questions

### Settled

_None yet — see § 8 for the grill round before code._

### Still open

- **Q-1. MCP `show` tool — separate from `query`?** Three options: (a) Ship `show` as a dedicated MCP tool (parallels CLI 1:1); (b) Skip MCP — agents call `query` with the SQL directly (one fewer tool to discover); (c) Add `show` only as a tool description hint, no separate registration. Bias toward (a) — uniform with how every other CLI verb maps to an MCP tool, plus the discoverability win is real (the tool listing teaches the agent `show` exists).
- **Q-2. Multiple matches — error or list-with-confirm?** Current proposal: error unless `--all` is set. Alternative: always list, prefix the first row with a "(N matches; use --kind to narrow)" hint. Bias toward "error by default" — agents that get a list back on a `name=foo` query may pick the wrong row; an explicit error forces them to add `--kind` or `--all`.
- **Q-3. Exact-match only or substring/regex?** Current proposal: `name = ?` exact match. Alternative: `name LIKE '%<name>%'` for fuzzy ("agent searches for `runQuery` and gets `runQueryCmd`"). Bias toward exact — fuzzy is what `query` is for; `show` is the precise read.
- **Q-4. Should `show` accept a file scope (`--in <path>`)?** Use case: same name in multiple files, agent knows which file. Could be `codemap show foo --in src/cli/cmd-query.ts`. Bias toward yes — cheap to add (just `AND file_path LIKE ?`) and the alternative is making the agent write SQL.
- **Q-5. Snippet sibling now or later?** `codemap snippet <name>` would slice the actual file content at `line_start..line_end` and return code text. Bias toward later — different feature (touches FS read, encoding, syntax-highlight question), ship `show` first.

## 8. Non-goals (v1)

- **Snippet output** (actual code text) — sibling feature; defer until a consumer asks.
- **Cross-symbol resolution** (e.g. `codemap show MyClass.method`) — not what the symbols table indexes today; would need a new lookup path. Use `query` with `parent_name = 'MyClass'` for now.
- **Fuzzy matching** — `query` already covers this with `LIKE` patterns.
- **Output sorting controls** — current default ORDER BY `file_path ASC, line_start ASC`. If a consumer wants different, use `query`.

## 9. References

- Roadmap entry: [`docs/roadmap.md` § Backlog](../roadmap.md#backlog).
- Symbols table shape: [`docs/architecture.md` § Schema](../architecture.md#schema).
- Doc lifecycle: this file follows the **Plan** type per [`docs/README.md` § Document Lifecycle](../README.md#document-lifecycle) — **delete on ship**, lift the canonical bits into `architecture.md` per Rule 2.
