# Competitive scan — fallow, AZidan/codemap, JordanCoin/codemap

> Inspiration scan from three sibling tools in the "AI-friendly code intelligence" space.
> Goal: identify candidates we should adopt, ignore, or watch for our positioning of
> **`@stainless-code/codemap`** (local SQLite index of structural metadata, queried via SQL).

Sources:

- [fallow-rs/fallow](https://github.com/fallow-rs/fallow) — Rust, ~1.1k stars, TS/JS-only, "codebase intelligence" (dead code, dupes, complexity, boundaries, runtime). 91 framework plugins.
- [AZidan/codemap](https://github.com/AZidan/codemap) — Python, ~55 stars, "make LLM reads cheaper" (symbol→line-range index). Multi-language tree-sitter.
- [JordanCoin/codemap](https://github.com/JordanCoin/codemap) — Go, ~525 stars, "project brain" (tree+diff+deps+skyline+handoff). Hooks/MCP/HTTP/skills.

---

## 1. Positioning recap (us)

We are: **structural SQLite index** → agents call **SQL** for symbols, imports, exports, components, calls, type members, deps, CSS tokens/classes/keyframes, markers. AST-backed (oxc, lightningcss, oxc-resolver). Bun + Node, TS/CSS-first. CLI **`codemap query --json`** + **`codemap agents init`** for IDE wiring.

We are **not**: dead-code detector, duplication finder, dependency-flow visualizer, semantic understanding layer, agent runtime/MCP server (yet).

---

## 2. Side-by-side

| Axis              | **us**                                  | fallow                                                 | AZidan/codemap                       | JordanCoin/codemap                           |
| ----------------- | --------------------------------------- | ------------------------------------------------------ | ------------------------------------ | -------------------------------------------- |
| Lang of impl      | TS (Bun/Node)                           | Rust                                                   | Python                               | Go                                           |
| Storage           | SQLite (`.codemap.db`)                  | in-process; SARIF/JSON outputs                         | distributed JSON (`.codemap/*.json`) | per-project `.codemap/` JSON artifacts       |
| Query surface     | **SQL** (full power)                    | CLI subcommands, `--format json`                       | `find`/`show`/`stats` CLI            | `tree`/`--diff`/`--deps`/`context`/MCP/HTTP  |
| What's indexed    | symbols, imports/exports, deps, CSS, …  | module graph, dupe clones, complexity, boundary rules  | symbols + line ranges + hash         | tree + dep flow + hubs + working set         |
| Agent integration | rules/skills via `agents init`          | MCP, LSP, VSCode ext, `--format json` w/ fix `actions` | Claude plugin, MCP planned           | hooks, MCP, HTTP, "context envelope", skills |
| Refresh model     | git-diff incremental + targeted `files` | full+changed-since                                     | hash + watch + git pre-commit        | daemon, hooks, watch                         |
| TS/JS depth       | oxc AST                                 | oxc AST + boundary/dup/complexity                      | tree-sitter                          | ast-grep (deps only)                         |
| Other langs       | CSS                                     | TS/JS only (intentional)                               | 14 langs (tree-sitter)               | 18 langs (deps via ast-grep)                 |
| Headline pitch    | "query your codebase"                   | "codebase truth layer for agents"                      | "make every read cheaper"            | "project brain for your AI"                  |
| License           | MIT                                     | MIT (+ paid runtime)                                   | MIT                                  | MIT                                          |

---

## 3. Candidates worth stealing / borrowing

Ranked by impact × fit for our SQL-index thesis. **Adopt** = strong fit; **Watch** = revisit;
**Pass** = scope/philosophy mismatch.

### 3.1 ADOPT — short list

#### A. **MCP server wrapping `query`** (already in [roadmap.md backlog](../roadmap.md))

- **Inspired by:** JordanCoin (`codemap mcp` over stdio + `list_skills`, `get_skill`, `context`), fallow (MCP server bundled in npm), AZidan (planned).
- **Why:** Our SQL surface is more powerful than any of theirs once exposed. An MCP `query`/`recipe`/`list_recipes` tool gives Cursor/Claude/Windsurf agents direct access without shelling out. Strongest single move.
- **Concrete shape:**
  - Tools: `query` (SQL string → JSON rows), `recipe` (id → JSON rows), `list_recipes` (catalog), `index` (incremental), `schema` (DDL).
  - Resources: bundled `SKILL.md`, `agents/rules/codemap.md`, current schema, recipe catalog.
  - Prompts: a couple of "explore this codebase" templates that pre-bind the SQL skill.
- **Fit:** Tracer-bullet friendly — slice = one tool (`query`) + one transport (stdio) wired into existing `cli/cmd-query.ts`.

#### B. **HTTP API** (`codemap serve`)

- **Inspired by:** JordanCoin (`codemap serve` → `/api/context`, `/api/skills`, `/api/working-set`).
- **Why:** Some integrations don't speak MCP yet. A localhost HTTP server with the same query/recipe surface (`POST /query`, `GET /recipes`, `GET /recipes/:id`, `GET /schema`) is ~50 lines and unblocks tooling outside the MCP ecosystem.
- **Caveat:** Bind to `127.0.0.1`. No auth needed for local; reject non-loopback unless `--host` overridden.

#### C. **Recipes-as-content registry** (extension of what we already ship)

- **Inspired by:** JordanCoin "skills framework" (markdown w/ YAML frontmatter, project-local override, `skill list`/`show`/`init`); fallow "framework plugins" (91 of them).
- **Why:** We already have `query --recipes-json` / `--print-sql`. Pairing each recipe with a short markdown explanation (when to use, what shape, follow-up SQL) gives agents executable context. A `codemap recipes show <id>` could print SQL + prose. Project-local recipes in `.codemap/recipes/*.sql` (or `.json`) would let teams ship internal SQL.
- **Concrete shape:**
  - Bundled recipes already exist in **`src/cli/query-recipes.ts`** — add an optional `description.md` sibling and surface in `--recipes-json`.
  - Allow user recipes from `.codemap/recipes/` (read at query time) — first-class extension point that doesn't require new adapter API.

#### D. **`codemap context` JSON envelope** for any agent/CLI

- **Inspired by:** JordanCoin `codemap context` / `--for "intent"` / `--compact`.
- **Why:** Single command emitting a stable JSON object — project metadata, schema version, top hubs, recent markers, file count, recipe catalog — that any agent can pipe into a prompt. Cheap to build because it's just a few of our existing recipes serialized into one envelope.
- **Stub:** `codemap context [--compact] [--for "<intent>"]` → `{ project, schema, hubs, recipes, recent_markers, file_count }`.

#### E. **Hash-based staleness check** (verify without re-reading)

- **Inspired by:** AZidan `codemap validate` (returns stale entries; LLM checks if a file changed _without_ re-reading).
- **Why:** We already store **`files.content_hash`** (SHA-256). Expose `codemap validate [paths…]` that prints stale paths in JSON. Tiny lift, big agent UX win — agents can ask "are my notes still valid?" for the cost of a SQL row, then re-read only the dirty ones.
- **One-liner:** `SELECT path FROM files WHERE content_hash != ?` — implementation just a CLI wrapper.

#### F. **Hub / fan-in summary as first-class output** (we have data, lacking presentation)

- **Inspired by:** JordanCoin "HUBS: config (12←), api (8←)" surface in `--deps`.
- **Why:** We already compute fan-in/fan-out via `dependencies` table and have a `fan-out` recipe. Add `hubs` recipe (top-N most-imported files) and surface in the `context` envelope above. Pure SQL, no new code.

#### G. **Doc-comment + `@deprecated` recipes** (we already store `doc_comment`)

- **Inspired by:** Fallow JSDoc visibility tags (`@public`, `@internal`, `@deprecated` driving dead-code policy).
- **Why:** Our `symbols.doc_comment` already preserves `@deprecated`. Recipes:
  - `deprecated-symbols` — `WHERE doc_comment LIKE '%@deprecated%'`
  - `internal-only` — visibility tag scan
- Cheap, recipe-only change.

### 3.2 WATCH — interesting, defer until v2

#### W1. **Targeted reads as the main UX** (AZidan)

- The "find symbol → read only lines 15–89" workflow is exactly what our `symbols.line_start/line_end` enables, but we don't currently ship a one-step CLI like `codemap show src/file.ts` or `codemap snippet symbolName`. Worth considering once MCP lands; agents can do it via SQL today.
- Low-hanging recipe: `read-symbol` — input `name` → output `file_path, line_start, line_end, signature`.

#### W2. **Watch mode** (already in roadmap; both JordanCoin and AZidan ship it)

- Both projects use file watchers (chokidar / `fsnotify`) to keep their index live. Our incremental + `--files` already cover most of this; a `codemap watch` is plumbing, not architecture.

#### W3. **Project-local skills/recipes** (JordanCoin, fallow plugins)

- A `.codemap/skills/*.md` or `.codemap/recipes/*.sql` directory that overrides bundled — same pattern as JordanCoin's project-local skill override. Pairs naturally with our existing `agents init`.

#### W4. **Cross-agent handoff artifact** (JordanCoin)

- Layered prefix/delta JSON written on session-stop, read on session-start. Interesting because it's complementary to indexing — a separate "what's been touched lately" log. Probably an _outside-of-codemap_ tool, but the daemon mode is worth thinking about (one persistent process can host MCP + HTTP + watcher).

#### W5. **Remote-repo support** (JordanCoin `codemap github.com/x/y`)

- Shallow clone to temp dir, index, query, cleanup. Trivial wrapper around `git clone --depth 1` + our existing CLI. Not central to our thesis but very low-cost demo.

### 3.3 PASS — explicit non-goals

| Idea                                                        | Source                              | Why we pass                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Dead-code, duplication, complexity, boundaries, fix-actions | fallow                              | Different product class. Our "structural index" thesis stays a primitive that fallow-style tools could _consume_. |
| Runtime/V8/Istanbul coverage merging, paid tier             | fallow runtime                      | Out of scope for v1; would massively expand surface.                                                              |
| 91 framework plugins                                        | fallow                              | They're entry-point detectors for _dead-code_. Our index isn't entry-point-aware (we index everything globbed).   |
| PageRank-style "summarization"                              | aider RepoMap (mentioned by AZidan) | We agree with AZidan: don't summarize, let the agent decide via SQL.                                              |
| Skyline ASCII-art / animation                               | JordanCoin                          | Pure demoware.                                                                                                    |
| Daemon process for hooks                                    | JordanCoin                          | Optional later. SQLite already supports concurrent readers; one-shot CLI is fine for now.                         |
| Embedded "intent classification" (regex over user prompts)  | JordanCoin                          | Belongs in the agent / MCP host, not in the index tool.                                                           |

---

## 4. Messaging lessons

The three highest-signal positioning lessons from this audit. Each one has a clear target file and a one-shot edit.

### 4.1 Anti-pitch — "what Codemap is **not**"

- **Source:** AZidan's _"What CodeMap is not"_ section ("not a semantic analyzer / not an LSP / not an agent / not smart").
- **Why it wins:** preempts the "is this an LSP / agent / smart tool?" question before the reader forms it. Cleaner than our current framing in [why-codemap.md](../why-codemap.md).
- **Where to land it:** [docs/why-codemap.md](../why-codemap.md) — add a subsection above "The Solution" that explicitly lists Codemap is **not** full-text search, **not** an LSP, **not** an agent, **not** a static analyzer / dead-code detector, **not** a semantic embedder.
- **Cost:** ~10 lines, pure docs.

### 4.2 Token-savings table — concrete scenarios, our own numbers

- **Source:** AZidan's table:
  | Scenario | Without | With | Savings |
  | --- | --- | --- | --- |
  | Single class lookup | 1,700 tok | 1,000 tok | 41% |
  | 10-file refactor | 51,000 tok | 11,600 tok | 77% |
  | 50-turn coding session | 70,000 tok | 21,000 tok | 70% |
- **Why it wins:** "very large vs ~5K" (our current text) reads as hand-waving. A 3-row table reads as evidence.
- **Where to land it:** [docs/why-codemap.md § Across a Typical Session](../why-codemap.md#across-a-typical-session) — replace the existing `Token cost (10/20 questions)` table with scenario-keyed rows.
- **Cost:** numbers come from `bun run benchmark:query` + `src/benchmark.ts` (already producing token impact estimates). Just present them.

### 4.3 "Grep/Read vs Codemap" capability table

- **Source:** Fallow's "Linter vs Fallow" table — rows like _"unused export that nothing imports"_ with `yes / no` per tool.
- **Why it wins:** concrete capability rows are far more persuasive than prose. Many such rows already live in our [golden-queries.md](../golden-queries.md) and [SKILL.md](../../.agents/skills/codemap/SKILL.md) but they're buried.
- **Where to land it:** [README.md](../../README.md), near the top — table with rows like:
  | Question | Grep / Read | Codemap |
  | --- | --- | --- |
  | Find symbol by exact name | yes (slow + noisy) | one SQL row |
  | Who imports `~/utils/date`? | resolve aliases manually | one SQL row |
  | Components using `useQuery` | grep + filter manually | one SQL row |
  | All CSS keyframes in project | grep `@keyframes` | one SQL row |
  | Heaviest files by import fan-out | impractical | one SQL row |
- **Cost:** ~15 lines of markdown, all queries already exist as recipes.

---

## 4b. Other doc-shape ideas (lower priority)

- **Comparison table — Codemap vs Aider RepoMap / Serena / RepoPrompt / Fallow** — situating row in [why-codemap.md](../why-codemap.md). AZidan's table is the model.
- **Fallow's "version-matched Agent Skill" framing** — we already do this via `templates/agents/`; calling it out as "version-matched" in README packaging copy is free credibility.
- **JordanCoin's "Daily commands" block** — curate 5–6 most-used commands at the top of the README CLI section instead of the current dense list.

---

## 5. Concrete suggested next steps (tracer-bullet sized)

Mapped to existing layers per [.cursor/rules/tracer-bullets.mdc](../../.cursor/rules/tracer-bullets.mdc):

1. **Recipe: `validate-stale-files`** — pure SQL recipe added to **`src/cli/query-recipes.ts`** (input: array of paths via SQL bind, output: stale paths). Tracer slice = one recipe + golden test. **(F + E above)**
2. **Recipe: `hubs`** — top-N most-imported files using `dependencies`. Pairs with existing `fan-out`. **(F)**
3. **Recipe: `deprecated-symbols`** — JSDoc-tag scan over `symbols.doc_comment`. **(G)**
4. **`codemap context` subcommand** — emits a JSON envelope composed from a fixed set of recipes. Tracer slice = one CLI command + 1 golden test on `fixtures/minimal/`. **(D)**
5. **MCP server (`codemap mcp`)** — single `query` tool first; expand later. Tracer slice = stdio transport + one tool wired through existing `runQueryCmd` core. **(A)**
6. **HTTP server (`codemap serve --port`)** — minimal Hono/native http, `POST /query` + `GET /recipes`. Tracer slice = `bun --hot` smoke test + golden response shape. **(B)**
7. **README polish** — add "Daily commands", "What Codemap is not", "Codemap vs alternatives" tables (see §4). Pure docs PR, no code.

---

## 6. Open questions

- **Should recipes own their description?** — JordanCoin couples skills + content tightly via YAML frontmatter; we currently keep recipes as code constants. Moving to one `recipes/<id>.{sql,md}` pair on disk (read at runtime via Bun `import.meta.glob` / Node `readdirSync`) makes them more discoverable and contributable.
- **Daemon vs one-shot** — JordanCoin's daemon is the only way they get sub-100ms hooks. Our CLI startup is ~50–100 ms cold (Node) and lower on Bun; we may not need a daemon at all. Worth measuring once MCP/HTTP land.
- **Path-prefix / monorepo workspace awareness** — fallow has `--changed-workspaces`, `--workspace @scope/app`, JordanCoin has implicit project root detection. Already in our [roadmap § Backlog](../roadmap.md#backlog).
- **Should we adopt fallow's `--save-baseline` pattern?** — only relevant once we ship audit-style commands; today we don't, so it's noise.

---

## 7. Citations / cross-links

- [docs/roadmap.md](../roadmap.md) — current backlog including MCP, watch mode, monorepo awareness.
- [docs/why-codemap.md](../why-codemap.md) — token-cost framing this scan should feed back into.
- [docs/architecture.md](../architecture.md) — schema and CLI layering touched by these proposals.
- [src/cli/query-recipes.ts](../../src/cli/query-recipes.ts) — where recipe additions land.
- [.agents/skills/codemap/SKILL.md](../../.agents/skills/codemap/SKILL.md) — agent guidance we'd extend with new recipes.
