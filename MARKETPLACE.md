# Codemap

> **SQL is the API for your codebase.**
> A SQLite-backed structural index of TypeScript, JavaScript, and CSS — symbols, imports, exports, React components, calls, type members, dependency graphs, CSS tokens, coverage, and TODO/FIXME markers across docs, configs, and scripts.
> Write any predicate. Compose any JOIN. Run it as a recipe in CI, as an MCP tool from your agent host, or over HTTP from anything.
> **Predicate-as-API. No LLM, no embeddings, no telemetry, no verdicts.**
> **Sub-millisecond queries. Sub-second incremental reindex. Sub-100ms cold-start.**

```text
$ codemap query --recipe index-summary
┌───┬───────┬─────────┬─────────┬────────────┬──────────────┐
│   │ files │ symbols │ imports │ components │ dependencies │
├───┼───────┼─────────┼─────────┼────────────┼──────────────┤
│ 0 │ 291   │ 3617    │ 591     │ 2          │ 319          │
└───┴───────┴─────────┴─────────┴────────────┴──────────────┘

$ codemap query --recipe untested-and-dead
┌───┬──────────────────┬───────────────────────────────────┬────────────┬──────────────┐
│   │ name             │ file_path                         │ line_start │ coverage_pct │
├───┼──────────────────┼───────────────────────────────────┼────────────┼──────────────┤
│ 0 │ legacyClient     │ src/api/client.ts                 │ 41         │ 0            │
│ 1 │ ProductCard      │ src/components/shop/ProductCard.tsx│ 11         │ 0            │
└───┴──────────────────┴───────────────────────────────────┴────────────┴──────────────┘
```

20+ bundled recipes ship out of the box. Drop your own SQL into `<projectRoot>/.codemap/recipes/` and it auto-discovers.

```yaml
# .github/workflows/codemap.yml
- uses: stainless-code/codemap@v1
```

That's the full setup. On every PR, the Action audits structural drift against the base branch and emits SARIF 2.1.0 → Code Scanning. Findings show up inline on the diff. New drift fails the check.

---

## Why this exists

Most static-analysis tools answer their own questions and hand you a verdict. Codemap inverts that posture: it ships the **substrate**, you write the question.

The substrate is a SQLite database with 14 tables — `symbols`, `imports`, `exports`, `dependencies`, `calls`, `components`, `type_members`, `markers`, `css_variables`, `css_classes`, `css_keyframes`, `coverage`, `boundary_rules`, `query_baselines`. The questions are SQL: 20+ bundled recipes you can read with `--print-sql`, modify, fork, or replace. JOINs across tables let you ask things no verdict-shaped tool can pre-bake:

```sql
-- "TODO comments inside @deprecated functions in files with <50% coverage"
SELECT m.file_path, m.line_number, m.content
FROM   markers m
JOIN   symbols s ON s.file_path = m.file_path
                 AND m.line_number BETWEEN s.line_start AND s.line_end
LEFT JOIN coverage c ON c.file_path = s.file_path
                     AND c.name      = s.name
                     AND c.line_start = s.line_start
WHERE  s.doc_comment LIKE '%@deprecated%'
   AND COALESCE(c.coverage_pct, 0) < 50
   AND m.kind = 'TODO';
```

That JOIN composes three indexed substrates — markers × symbols × coverage — in one round-trip. There's no command-line flag for that question. There never will be. **You write it. Codemap runs it.**

The Action wraps that posture for CI: PR-scoped audit by default, recipe-driven gates when you want more, and the same substrate exposed over MCP / HTTP for agent hosts that want richer queries.

---

## Built for agents

Agents discover code the slow way: glob, read, grep, read more, re-grep. Every discovery question burns context window, wastes tokens, slows response time, and produces false positives. Codemap collapses that loop into one SQL round-trip against a structured index.

We supply the structure. The agent (human or otherwise) supplies the meaning. Two different jobs.

The agent-host integration is first-class. `codemap mcp` exposes every CLI verb as a JSON-RPC tool over stdio for Claude Code, Cursor, Codex, Windsurf. `codemap agents init` writes `AGENTS.md` / `CLAUDE.md` / `.cursor/rules/codemap.mdc` / `.cursor/skills/codemap/SKILL.md` with a version-matched skill teaching agents the schema, recipes, and SQL idioms. Drop-in for any agent host that reads these conventions.

---

## What you get on a PR

- **Structural-drift audit** — three deltas surface as Code Scanning rules: `codemap.audit.files-added`, `codemap.audit.dependencies-added`, `codemap.audit.deprecated-added`. Inline annotations on the diff.
- **Optional markdown PR comment** (`pr-comment: true`) — collapsed `<details>` sections per delta, useful when SARIF → Code Scanning isn't available (private repos without Advanced Security) or you want bot-context seeding (review bots read PR conversation).
- **Recipe-driven gates** — set `mode: recipe` to gate on any of the 20+ bundled recipes through the same SARIF + PR-comment surface.
- **Non-zero exit on findings** so `--ci` failures fail the workflow.

## Bundled recipes

Each runs through the same `--format sarif | annotations | json | mermaid | diff` output pipeline.

| Question                                                      | Recipe                                        |
| ------------------------------------------------------------- | --------------------------------------------- |
| What's structurally dead AND untested?                        | `untested-and-dead`                           |
| What exports does nothing import?                             | `unimported-exports`                          |
| What's `@deprecated`?                                         | `deprecated-symbols`                          |
| What components touch deprecated APIs?                        | `components-touching-deprecated`              |
| What boundary rules are violated? (config-driven SQLite GLOB) | `boundary-violations`                         |
| What's complex AND uncovered?                                 | `high-complexity-untested`                    |
| Which files / exports have the worst coverage?                | `files-by-coverage` · `worst-covered-exports` |
| Which files are barrel hubs? (high export count)              | `barrel-files`                                |
| Who's the most depended-on? (fan-in)                          | `fan-in`                                      |
| What does this file fan out to?                               | `fan-out`                                     |
| Where is this symbol defined? Show me a rename preview.       | `find-symbol-by-kind` · `rename-preview`      |
| Which components use this hook?                               | `components-by-hooks`                         |
| What's tagged `@public` / `@internal` / `@beta` / `@alpha`?   | `visibility-tags`                             |
| What are the riskiest refactor targets?                       | `refactor-risk-ranking`                       |
| What TODOs / FIXMEs / HACKs by kind?                          | `markers-by-kind`                             |
| Project summary stats                                         | `index-summary`                               |

`codemap query --recipes-json` lists all of them. `codemap query --print-sql <id>` shows the SQL.

## What's in the index

Indexed at parse time via [oxc](https://oxc.rs) (JS/TS) + [lightningcss](https://lightningcss.dev) (CSS) + a regex pass for markers:

| Substrate             | What it captures                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `symbols`             | Functions, classes, consts, types — name, kind, file:line range, signature, JSDoc, `@deprecated`, `complexity`, `visibility` |
| `imports` / `exports` | Per-file specifier lists with type-only flag, default flag, re-export source                                                 |
| `dependencies`        | Resolved import edges (`from_path` → `to_path`)                                                                              |
| `calls`               | Function-scoped call edges (`caller_scope` → `callee_name`), deduped per file                                                |
| `components`          | React components with `props_type` + `hooks_used` JSON                                                                       |
| `type_members`        | Field-level type inventory (interface / type alias / class member)                                                           |
| `markers`             | TODO / FIXME / HACK / NOTE / XXX with file:line + content                                                                    |
| `css_variables`       | CSS custom properties (`--token`) with scope                                                                                 |
| `css_classes`         | CSS class names with `is_module` flag                                                                                        |
| `css_keyframes`       | `@keyframes` declarations                                                                                                    |
| `coverage`            | Istanbul JSON / LCOV ingested via `codemap ingest-coverage` — joinable to `symbols` for "untested AND dead" queries          |
| `source_fts`          | Opt-in (`--with-fts` / `fts5: true`) full-text search joinable to every other table                                          |
| `boundary_rules`      | Config-derived from `codemap.config.{ts,js,json}` — feeds the `boundary-violations` recipe                                   |
| `query_baselines`     | Saved `query --save-baseline` snapshots; survive `--full` rebuilds                                                           |

All `STRICT` mode tables. Schema versioned; reindex is idempotent + sub-second on incremental changes.

## Supported file types

| Depth                       | Formats                                                               | What you get                                                                                 |
| --------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Deep AST (oxc)**          | `.ts` · `.tsx` · `.mts` · `.cts` · `.js` · `.jsx` · `.mjs` · `.cjs`   | `symbols` · `imports` · `exports` · `components` · `calls` · `type_members` · `dependencies` |
| **Deep CSS (lightningcss)** | `.css`                                                                | `css_variables` · `css_classes` · `css_keyframes`                                            |
| **Markers (regex)**         | `.md` · `.mdx` · `.mdc` · `.yml` · `.yaml` · `.json` · `.sh` · `.txt` | `markers` (TODO / FIXME / HACK / NOTE with file:line + content)                              |

Sass / Less / SCSS / Vue / Svelte / Astro / Python and other deep-parsers are tracked as community language adapters in the roadmap. See [`roadmap.md`](https://github.com/stainless-code/codemap/blob/main/docs/roadmap.md).

## Architecture boundaries

Declare layered boundaries in `codemap.config.{ts,js,json}` — the `boundary-violations` recipe joins your rules against `dependencies` via SQLite GLOB. Zero-runtime cost; surfaces in SARIF on every PR.

```ts
// codemap.config.ts
export default {
  boundaries: [
    {
      name: "ui-cant-touch-server",
      from_glob: "src/ui/[^/]*",
      to_glob: "src/server/*",
    },
    {
      name: "domain-pure",
      from_glob: "src/domain/*",
      to_glob: "src/{ui,server,db}/*",
    },
  ],
};
```

## CI gating

Audit drift since the base ref:

```bash
codemap audit --base origin/main --ci
```

Recipe-driven gating on findings:

```bash
codemap query --recipe untested-and-dead --ci
codemap query --recipe boundary-violations --ci
codemap query --recipe deprecated-symbols --ci
```

`--ci` aliases `--format sarif` + non-zero exit on findings + quiet stdout. Pipe directly to GitHub Code Scanning, or render as a PR-conversation comment via `codemap pr-comment`.

---

## Quick start

```yaml
# .github/workflows/codemap.yml
name: Codemap

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  security-events: write # required for SARIF upload to Code Scanning
  pull-requests: write # only if you set `pr-comment: true`

jobs:
  codemap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # so audit can see the base ref
      - uses: stainless-code/codemap@v1
```

Defaults work for the headline use case: PR-scoped audit on `pull_request` events; no-op on other events.

## Examples

**Run a single recipe instead of the full audit:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    mode: recipe
    recipe: untested-and-dead
```

**Post a PR comment on private repos without Advanced Security:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    pr-comment: true
    upload-sarif: false
```

**Group findings by CODEOWNERS team in a monorepo:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    mode: recipe
    recipe: untested-and-dead
    group-by: owner
```

**Run a parametrised recipe:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    mode: recipe
    recipe: rename-preview
    params: |
      old=oldFn
      new=newFn
```

**Pin a specific codemap CLI version:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    version: "0.5.0"
```

**Escape hatch for arbitrary invocations:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    command: "query --recipe boundary-violations --format sarif"
```

## Configuration

All inputs are optional.

| Input               | Default                                      | Description                                                            |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| `working-directory` | `.`                                          | Subdirectory to run codemap in (for monorepos).                        |
| `package-manager`   | _autodetect_                                 | Override autodetect: `npm` / `pnpm` / `yarn` / `yarn@berry` / `bun`.   |
| `version`           | _project devDep → latest_                    | Pin codemap CLI version.                                               |
| `state-dir`         | _`.codemap/`_                                | Override state directory location.                                     |
| `mode`              | `audit`                                      | `audit` / `recipe` / `command`. (`aggregate` reserved for v1.x.)       |
| `recipe`            | _empty_                                      | Recipe id (when `mode: recipe`).                                       |
| `params`            | _empty_                                      | Recipe params; multiline `key=value`.                                  |
| `baseline`          | _empty_                                      | Saved baseline name to diff against.                                   |
| `audit-base`        | _`github.base_ref` on `pull_request` events_ | Git ref to audit against.                                              |
| `changed-since`     | _empty_                                      | Filter to files changed since the given git ref.                       |
| `group-by`          | _empty_                                      | Bucket by `owner` (CODEOWNERS) / `directory` / `package`.              |
| `command`           | _empty_                                      | Raw CLI args (escape hatch).                                           |
| `format`            | `sarif`                                      | `sarif` / `json` / `annotations` / `mermaid` / `diff`.                 |
| `output-path`       | `codemap.sarif`                              | Where to write the output.                                             |
| `upload-sarif`      | `true`                                       | Upload to Code Scanning. Set `false` if Code Scanning isn't available. |
| `pr-comment`        | `false`                                      | Post a markdown summary comment on the PR.                             |
| `fail-on`           | `any`                                        | Exit-code policy: `any` / `never`.                                     |
| `token`             | _`github.token`_                             | Token for SARIF upload + PR comment posting.                           |

The Action also exposes a few step outputs (`exec`, `agent`, `install_method`, `output-file`) for workflows that chain additional codemap commands; see [`action.yml`](https://github.com/stainless-code/codemap/blob/main/action.yml) for the contract.

---

## Four transports, one engine

The same engines back every surface; switch transports without re-learning anything.

- **CLI** — `npx @stainless-code/codemap …`. 12+ verbs: `query`, `audit`, `show`, `snippet`, `impact`, `context`, `validate`, `watch`, `ingest-coverage`, `pr-comment`, `agents init`, `mcp`, `serve`.
- **MCP server** — `codemap mcp` over stdio. Every CLI verb maps to a JSON-RPC tool; six lazy-cached resources (`codemap://recipes`, `codemap://recipes/{id}`, `codemap://schema`, `codemap://files/{path}`, `codemap://symbols/{name}`, `codemap://skill`).
- **HTTP server** — `codemap serve` exposes the same tool set over `POST /tool/{name}` for non-MCP consumers (curl, IDE plugins, CI scripts that don't speak MCP). Loopback default; optional `--token` Bearer auth.
- **GitHub Action** — this listing. Wraps the CLI for CI; emits SARIF → Code Scanning + optional PR comment.
- **Watch mode** (standalone or layered into `mcp` / `serve`, default ON) — chokidar-backed live reindex; consumers always read fresh state.

LSP support (recipes-as-squigglies in VS Code + Open VSX) is tracked on the roadmap.

## Performance

- **Sub-millisecond queries** on typical structural questions — one SQL round-trip vs the multi-tool-call traditional path that scales with how many files it must read and scan.
- **Sub-second incremental reindex** — git-driven invalidation re-parses only the files whose `content_hash` changed.
- **One-shot CLI cold-start** under 100 ms — `query` / `show` / `snippet` / `impact` / `audit` spawn no watcher.

## Permissions

- `contents: read` — checkout the repo.
- `security-events: write` — `upload-sarif: true` (default) writes to Code Scanning.
- `pull-requests: write` — `pr-comment: true` posts a comment.

## How it works

1. **Skip-on-non-PR-events** without `command:` set — friendly log + exit 0.
2. **Detect package manager** via [`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector) (lockfile → `packageManager` field → `devEngines.packageManager` → install-metadata → walk-up → `npm` fallback).
3. **Resolve CLI invocation** — project-installed first, `dlx` fallback. `version:` input forces a pinned `dlx`.
4. **Validate inputs** — `mode: recipe` without `recipe:` is a hard error; `mode: aggregate` reserved for v1.x.
5. **Run codemap** — SARIF / JSON / annotations / mermaid / diff written to `output-path`.
6. **Upload SARIF** to Code Scanning (if `upload-sarif: true` and `format: sarif`).
7. **Post PR comment** via `codemap pr-comment | gh pr comment` (if `pr-comment: true` on `pull_request`).

## Versioning

Action publishes at `v1.0.0`, independent of the codemap CLI's npm version. The `@v1` floating tag advances with every minor/patch release; pin to `@v1.2.3` for exact reproducibility.

## Limitations

- Default audit runs on `pull_request` events only. Pass `command:` for other event types.
- SARIF → Code Scanning requires Advanced Security on private repos. Set `upload-sarif: false` and rely on `pr-comment: true` for visibility.
- `mode: aggregate` (run audit + curated recipes in one invocation) reserved for v1.x.
- Static analysis only — no LLM, no embeddings, no runtime tracing. Coverage is ingested statically from Istanbul/LCOV files.
- Deep AST extraction is JavaScript / TypeScript / CSS first; Sass / Less / SCSS / Vue / Svelte / Astro / Python adapters are tracked as roadmap items. Marker extraction (TODO / FIXME / HACK / NOTE) is broader: Markdown, MDX, YAML, JSON, and shell scripts.

## Source + license

- Repository: [stainless-code/codemap](https://github.com/stainless-code/codemap)
- CLI on npm: [`@stainless-code/codemap`](https://www.npmjs.com/package/@stainless-code/codemap)
- Documentation: [docs/](https://github.com/stainless-code/codemap/tree/main/docs)
- Issues: [GitHub Issues](https://github.com/stainless-code/codemap/issues)
- License: MIT
