# Agent templates and `codemap agents init`

**Doc index:** [README.md](./README.md). **Package layout:** [packaging.md](./packaging.md) (`templates/` on npm). **CLI layering:** [architecture.md § Key Files](./architecture.md#key-files).

## What it does

The published package ships two parallel directories under `templates/`:

| Directory                      | Role                                                                                                                 | Lifecycle                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`templates/agents/`**        | Consumer-disk targets — what **`codemap agents init`** copies into **`<project>/.agents/`**                          | Stable across releases; only changes when the pointer protocol shape changes |
| **`templates/agent-content/`** | Server-side source served by **`codemap skill`** / **`codemap rule`** / **`codemap://skill`** / **`codemap://rule`** | Updates every release as recipes / schema / narrative evolve                 |

The split exists so consumers can `bun update @stainless-code/codemap` and pick up today's reference content automatically — **the file on their disk is a thin pointer that always fetches live**. No `agents init --force` needed unless the pointer shape itself changes.

This repo also has [`.agents/`](../.agents/) for Codemap development (CLI from source); after the v1 pointer rewrite it mirrors `templates/agents/` (pointers, not fat content). Drift between the two should be zero — both regenerate from the same templates via `bun src/index.ts agents init --force`.

**Maintenance discipline (post-pointer-protocol):**

- **Code, schema, recipe changes** → auto-flow into the served skill via `*.gen.md` renderers in `src/application/agent-content.ts`. No template edit required.
- **Hand-written narrative changes** (overview, recipes context, query patterns, maintenance, troubleshooting) → edit `templates/agent-content/skill/*.md` directly. Single source of truth.
- **Pointer template shape changes** (frontmatter schema, fetch instructions, marker comments) → edit `templates/agents/{rules/codemap,skills/codemap/SKILL}.md` AND bump `EXPECTED_POINTER_VERSION` in `src/application/agent-content.ts` so consumers see the staleness nag and re-run `agents init --force`.

**Query examples** in the bundled **codemap** rule and skill lead with **`codemap query --json`** (agents and automation). Omit **`--json`** when you want **`console.table`** in a terminal — see [README.md § CLI](../README.md#cli).

```bash
codemap agents init
codemap agents init --force
codemap agents init --interactive   # or -i; requires a TTY
codemap agents init --mcp             # project MCP config (default project-local targets; Windsurf opt-in via -i)
codemap agents init --targets cursor,copilot --mcp   # non-interactive: subset of integrations + MCP
codemap agents init --targets copilot                    # Copilot instructions only (no MCP)
codemap agents init --targets windsurf --link-mode copy  # rule mirrors as copies (sandboxes / Windows)
codemap agents init --git-hooks       # opt-in background index on git events
codemap agents init --no-git-hooks    # remove codemap hook blocks
```

- **`--force`** — if **`.agents/`** already exists, delete only the **same file paths** that ship in **`templates/agents`** (under **`rules/`** and **`skills/`**), then copy those files from the template. Any **other** files next to them (your custom rules, extra skill dirs, notes at **`.agents/`** root, etc.) are **not** removed. IDE mirrors (`.cursor/rules`, …) sync **only bundled template paths** (today `rules/codemap.md` and `skills/codemap/SKILL.md`) — not your whole **`.agents/`** tree. **`--force`** overwrites an existing IDE mirror **only** when it has **`<!-- codemap-init:managed -->`** or matches the **legacy mirror heuristic** (see [§ IDE mirror provenance](#ide-mirror-provenance-codemap-initmanaged)). Pointer files (`CLAUDE.md`, …): **`--force`** refreshes the `codemap-pointer` section only; your prose outside the markers is kept. Use **`--interactive`**, not a bare **`interactive`** argument (unknown tokens are rejected).
- **`--interactive`** — multiselect which tools to wire (see below); choose **symlink** vs **copy** for integrations that mirror **bundled** **`.agents/rules`** paths (and Cursor also bundled **`.agents/skills`**). Uses [**@clack/prompts**](https://github.com/bombshell-dev/clack); **non-TTY** runs exit with an error. Mutually exclusive with **`--targets`**.
- **`--targets`** — comma-separated integration ids (`cursor`, `copilot`, `claude-md`, `windsurf`, `continue`, `cline`, `amazon-q`, `agents-md`, `gemini-md`) or repeated `--targets` flags. Wires IDE mirrors without a TTY. With **`--mcp`**, only MCP configs for the selected integrations are written (e.g. `cursor` alone → `.cursor/mcp.json` only, not root `.mcp.json`). Default **`--link-mode`** is **symlink** when omitted. Unknown ids exit 1 with the valid list.
- **`--link-mode`** — `symlink` or `copy`; only valid when **`--targets`** includes a rule-mirror integration (`cursor`, `windsurf`, `continue`, `cline`, `amazon-q`).

## Git and `.gitignore`

Codemap maintains its own self-managed **`<state-dir>/.gitignore`** (default `.codemap/.gitignore`) — a blacklist of generated artifacts (`index.db` + WAL/SHM, `audit-cache/` entry in the canonical list) reconciled to canonical on every codemap boot via `ensureStateGitignore` (`src/application/state-dir.ts`). **`audit --base` cache** physically lives at `<projectRoot>/.codemap/audit-cache/` (hardcoded; does not follow `--state-dir`). Project-tracked sources (`recipes/`, `config.{ts,js,json}`) default to tracked.

The user's root **`.gitignore`** is no longer touched by `codemap agents init`. Future codemap versions can add new generated artifacts to the canonical blacklist; every consumer's project repairs itself on the next `codemap` invocation. **The setup logic IS the migration** — `ensureStateGitignore` reconciles on every boot (`src/application/state-dir.ts`).

## Optional IDE / tool wiring

All integrations reuse the **same** bundled content under **`.agents/`**. Symlink-style rows use one **link mode** for the whole run (**symlink** or **copy**) when any of them is selected.

| Integration                           | What gets created                                                                             | Notes                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**                            | **`.cursor/rules`** → bundled **`.agents/rules`** paths; skills stay in **`.agents/skills/`** | Per-file symlink or copy of **bundled** rule paths only (not your whole **`.agents/`** tree). Cursor loads skills from `.agents/skills/` natively. |
| **Windsurf**                          | **`.windsurf/rules`** → bundled **`.agents/rules`** paths                                     | Bundled rules only.                                                                                                                                |
| **Continue**                          | **`.continue/rules`** → bundled **`.agents/rules`** paths                                     | [Continue rules](https://docs.continue.dev/customize/rules).                                                                                       |
| **Cline**                             | **`.clinerules`** → bundled **`.agents/rules`** paths                                         | Per-file symlink or copy (bundled paths only).                                                                                                     |
| **Amazon Q**                          | **`.amazonq/rules`** → bundled **`.agents/rules`** paths                                      | [AWS rules](https://aws.amazon.com/blogs/devops/mastering-amazon-q-developer-with-rules/).                                                         |
| **GitHub Copilot**                    | **`.github/copilot-instructions.md`**                                                         | Pointer + link to [GitHub Docs](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot).                |
| **Claude Code**                       | **`CLAUDE.md`**                                                                               | Root onboarding pointer.                                                                                                                           |
| **Zed / JetBrains / Aider (generic)** | **`AGENTS.md`**                                                                               | Many tools read root **`AGENTS.md`**; JetBrains/Aider have no single mandated path — this file is the shared hook.                                 |
| **Gemini**                            | **`GEMINI.md`**                                                                               | For integrations that load **`GEMINI.md`**.                                                                                                        |

## Git hooks (opt-in freshness)

When the file watcher is off (WSL `/mnt/*` mounts, `CODEMAP_WATCH=0`, etc.), **`codemap agents init --git-hooks`** installs marker-delimited blocks in **`post-commit`**, **`post-merge`**, and **`post-checkout`** that run `( codemap >/dev/null 2>&1 & )` — non-blocking background incremental index. **`--no-git-hooks`** removes only codemap-marked blocks. Interactive init offers hooks automatically when [`watch-policy.ts`](../src/application/watch-policy.ts) would disable the watcher for the project root.

Concurrent indexers (CLI, MCP `--watch`, git hooks) coordinate via **`<state-dir>/index.lock`**. If indexing fails with “Index already running” after a crash, run **`codemap unlock`**. Per-file parse failures append to **`<state-dir>/errors.log`**.

## Pointer files

Root / Copilot **pointer** files (**`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`**, **`.github/copilot-instructions.md`**) use a **managed section** between **`<!-- codemap-pointer:begin -->`** and **`<!-- codemap-pointer:end -->`** (HTML comments — usually hidden in rendered Markdown):

| Situation                                                                    | Behavior                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| File missing                                                                 | Write that section (with markers).                                                                            |
| File exists, section present                                                 | **Replace only** that section — idempotent re-runs, no duplicate blocks; template updates fix **stale** text. |
| File exists, no section, but content looks like an **old** Codemap-only file | **Replace whole file** with the managed section (one-time migration).                                         |
| File exists with other content (e.g. your team intro)                        | **Append** the managed section **once**.                                                                      |
| **`--force`**                                                                | Refresh the **managed pointer section** only; user content outside markers is preserved.                      |

Append alone would duplicate on every run — markers + replace are what prevent duplicates and staleness.

## IDE mirror provenance (`codemap-init:managed`)

Bundled templates ship **`<!-- codemap-init:managed -->`**. **Copy mode** writes that marker into IDE mirror files; **symlink mode** inherits it from the **`.agents/`** target (init checks marker content through the link).

| Surface                                                                         | `--force` overwrite policy                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`.agents/`** bundled paths (`rules/codemap.md`, `skills/codemap/SKILL.md`, …) | Always refreshed — path whitelist only; marker not required.                                                                                                                                                                                                                                           |
| **IDE mirrors** (`.cursor/`, `.windsurf/`, …)                                   | Only when the dest file has **`codemap-init:managed`**, or content matches a **legacy Codemap mirror** (pre-marker copy from bundled templates: `codemap query` plus `codemap-pointer-version`, `codemap://rule`, or `stainless-code/codemap`). User-owned files at those paths are never overwritten. |

**Legacy heuristic caveat:** Long user-authored prose at a bundled mirror path that quotes official Codemap docs could match once — delete that file manually if **`--force`** refreshes something you did not intend.

**Upgrading from pre-marker init:** Re-run **`codemap agents init --force`** with your IDE targets selected (or **`--interactive`**). Copy-mode mirrors from older inits are migrated once via the legacy heuristic; symlink mode needs no mirror migration (init reads markers through the link into **`.agents/`**). If **`--force`** still refuses a mirror path, delete that single file manually and re-run init.

## Live fetch surface (CLI + MCP + HTTP)

Once `agents init` has written the pointer templates, the consumer's disk holds ~18-line SKILL + ~25-line rule. The actual content is served live:

| Surface                | Skill                                                    | Rule                                                    |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| CLI                    | `codemap skill`                                          | `codemap rule`                                          |
| MCP                    | resource `codemap://skill`                               | resource `codemap://rule`                               |
| HTTP (`codemap serve`) | `GET /resources/{encoded uri}` against `codemap://skill` | `GET /resources/{encoded uri}` against `codemap://rule` |

All three transports resolve to the same `assembleAgentContent(kind)` function in `src/application/agent-content.ts` — there is no MCP-only or HTTP-only path for skill/rule content. The MCP and HTTP paths share a lazy per-process cache via `readResource()` in `src/application/resource-handlers.ts` for schema/skill/rule/mcp-instructions; recipes, files, and symbols read live every call. The CLI re-assembles every call (cheap — markdown read + concat).

## MCP server instructions

`codemap mcp` passes a tool-selection playbook in the MCP **`initialize`** response **`instructions`** field. MCP clients (Cursor, Claude Code, etc.) inject this into the agent system prompt — operational guidance only (which tool when, common chains, anti-patterns). Full schema and recipe catalog stay on **`codemap://skill`** / **`codemap://rule`**.

| Surface             | URI / field                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| MCP initialize      | `instructions` on handshake                                                                                    |
| MCP / HTTP resource | `codemap://mcp-instructions`                                                                                   |
| Source file         | `templates/agent-content/mcp-instructions.md` (assembled by `assembleMcpInstructions()` in `agent-content.ts`) |

Recipe ids cited in the playbook are machine-validated in tests against the live catalog (`extractMcpInstructionRecipeIds`).

## MCP session lifecycle

Long-running **`codemap mcp`** stays up for the whole IDE session while the stdio pipe is open — **there is no idle timeout** that exits after N minutes without tool calls. Cursor / Claude Code spawn MCP once; they do not reliably respawn it mid-conversation, so an idle shutdown would break long pauses with no recovery path.

**Exit triggers (MCP):** client disconnect only — stdin EOF, stdout broken pipe (`EPIPE`), boot parent process gone, or SIGINT/SIGTERM. Implementation: `src/application/session-lifecycle.ts` (`createStdioDisconnectMonitor`).

**Not idle timeout:** HTTP **`serve --watch`** uses a 5s **watch release grace** after the last non-`/health` request — that stops chokidar between stateless requests, not the MCP/HTTP process. **`GET /health`** never acquires a watch client.

See [architecture.md § Session lifecycle wiring](./architecture.md#session-lifecycle-wiring).

## MCP tool allowlist

**`context.index_freshness`** — session bootstrap includes index-level freshness metadata: `commit_drift` (HEAD ≠ `last_indexed_commit`), `pending_sync` (watcher debounce queue or in-flight reindex), optional disk-drift counts when watch is off, and a single `warning` string when agents should pause or re-index. **`context.start_here`** (non-compact) adds inline index summary, intent-ranked `query_recipe` cards, and top hub files with export signatures (adaptive caps by file count; optional MCP/HTTP `include_snippets` for one-line previews). **`context.map_id`** + **`context.codebase_map`** (non-compact, default on) add a hash-stable routing card: top hub paths plus codemap CLI outcome aliases and session-start MCP tools — omit with `--no-codebase-map` / `include_codebase_map: false` or `--compact`. MCP initialize **`instructions`** also carry `map_id` and top three hubs; call **`context`** for the full map. Debug intent biases `sample_markers` toward FIXME/TODO. **MCP:** array-shaped JSON tools (`query`, …) keep row payloads verbatim and append a second `content` block prefixed `@codemap/index_freshness`; object-shaped tools merge `index_freshness` inline. **HTTP:** `POST /tool/*` adds `X-Codemap-Pending-Sync`, `X-Codemap-Commit-Drift`, and `X-Codemap-Warning` headers without changing JSON bodies; **`GET /health`** includes full cheap `index_freshness` when the DB is readable. Complements per-file `validate` / snippet `stale`. See [architecture.md § Context wiring](./architecture.md#context-wiring).

**MCP ToolAnnotations** — `tools/list` (and HTTP `GET /tools`) expose advisory `readOnlyHint` / `destructiveHint` / `idempotentHint` per tool so clients can gate auto-approval. Read paths (`query`, `show`, `audit`, …) → `readOnlyHint: true`; disk-write apply tools → `destructiveHint: true` (writes still require `yes: true`); index mutators (`save_baseline`, `drop_baseline`, `ingest_coverage`, `ingest_churn`) → `readOnlyHint: false` without `destructiveHint`.

**`CODEMAP_MCP_TOOLS`** — comma-separated snake_case MCP tool names. When set, only listed tools register (stderr lists the active set). Unknown names are ignored with a warning. Unset = all tools (default). **`query_batch`** registers only when listed or when unset (eval ablation).

Example: `CODEMAP_MCP_TOOLS=query,context,show codemap mcp --no-watch`

**Agent eval live arms** — see [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness) for `AGENT_EVAL_MODE=live`, log comparison, and the minimal eval subset (`query`, `query_recipe`).

## MCP wiring via `agents init`

**`codemap agents init --mcp`** (or the interactive prompt) writes project MCP config without duplicating skill/rule markdown. Registry source of truth: **`src/agents-init-mcp-registry.ts`** (`AGENTS_INIT_MCP_REGISTRY`).

| Target             | Files written                                                                                                                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cursor             | `.cursor/mcp.json` — PM-resolved spawn + `mcp --watch --root ${workspaceFolder}` (e.g. `npx codemap`, `pnpm exec codemap`, `yarn exec codemap`, `bunx codemap`)                                                                                      |
| Claude Code        | `.mcp.json` + `.claude/settings.json` — `permissions.allow` includes `mcp__codemap__*`                                                                                                                                                               |
| VS Code / Copilot  | `.vscode/mcp.json` — `servers.codemap` with `type: stdio` + `mcp --watch --root ${workspaceFolder}` (PM-resolved spawn, same tail as Cursor)                                                                                                         |
| Continue           | `.continue/mcpServers/codemap-mcp.json` (JSON `mcpServers`; also accepted from Cursor/Cline exports)                                                                                                                                                 |
| Amazon Q Developer | **`.amazonq/default.json`** (IDE canonical) + **`.amazonq/mcp.json`** (legacy workspace; still read when global `useLegacyMcpJson` is true — AWS default). [AWS MCP IDE docs](https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/mcp-ide.html) |
| Gemini CLI         | `.gemini/settings.json` — top-level `mcpServers.codemap`                                                                                                                                                                                             |
| Cline              | `.cline/mcp.json` ([Cline CLI reference](https://docs.cline.bot/cli/cli-reference); global IDE settings may also use `~/.cline/data/settings/cline_mcp_settings.json`)                                                                               |
| Windsurf (Cascade) | `~/.codeium/windsurf/mcp_config.json` ([Windsurf docs](https://docs.windsurf.com/windsurf/cascade/mcp) — user-global only; written when Windsurf integration is selected)                                                                            |

With **`--mcp`** and no **`--targets`** filter, all **project-local** rows above are written except **Windsurf**, which has no documented workspace MCP path.

Merge is idempotent: foreign MCP servers and existing settings keys are preserved; only the `codemap` server entry and permission pattern are upserted. **`command` / spawn args are resolved from the project** (when `@stainless-code/codemap` is listed in `package.json`, the local PM runner is used — e.g. `pnpm exec codemap`, `yarn exec codemap`, `bunx codemap`; otherwise PM dlx of `@stainless-code/codemap@latest` — e.g. `npx @stainless-code/codemap@latest`, `pnpm dlx @stainless-code/codemap@latest`, `yarn dlx @stainless-code/codemap@latest`; yarn classic may fall back to `npx` per `package-manager-detector`; Bun uses **`bunx`**, not `bun x`). Init logs the chosen invocation (`MCP CLI: …`).

**Side-effect-only re-runs:** When `.agents/` already exists, `codemap agents init --mcp`, **`--interactive`** target wiring (or any explicit integration targets), or `--git-hooks` still apply without `--force`. `codemap agents init --no-git-hooks --mcp` uninstalls hook blocks and writes MCP even when `.agents/` is absent. Template refresh still requires `--force`. Unparseable MCP JSON and invalid `mcpServers` / `servers` **shape** are **rejected** (fix the file manually — init never wipes or resets those maps, even with `--force`). Foreign MCP servers in a valid map are always preserved on merge. Re-runs upsert the codemap server entry in place (e.g. add `--root ${workspaceFolder}` on VS Code when an older `.vscode/mcp.json` omitted it). Cursor and VS Code get explicit `--root` because host docs do not guarantee stdio spawn `cwd` equals the workspace folder.

## Section assembler and `*.gen.md`

`templates/agent-content/<kind>/` is a directory of section files concatenated in lexical name order (joined with a blank line). A numeric prefix (`00-`, `10-`, …) controls section order so renumbering is a file-rename, never a code edit.

`*.gen.md` files have special semantics: if a renderer is registered for the path `<kind>/<filename>` in the `RENDERERS` map (in `agent-content.ts`), the renderer's output replaces the on-disk file body at assembly time. The on-disk file still controls section ordering and carries a hand-written fallback for environments where the renderer's data source is unreachable (today: none).

Current skill section layout:

| File                    | Source                                    | Updates when                                                            |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `00-overview.md`        | Hand-written                              | Rare (intro / CLI usage / output contract)                              |
| `10-recipes-context.md` | Hand-written                              | Rare (flags, MCP/HTTP/Apply, tools, resources)                          |
| `20-recipes.gen.md`     | Generated from `listQueryRecipeCatalog()` | Every recipe added under `templates/recipes/` or `<state-dir>/recipes/` |
| `30-schema.gen.md`      | Generated from `createTables()` DDL       | Every column / table added in `src/db.ts`                               |
| `40-query-patterns.md`  | Hand-written                              | Rare (basic / dep / component / CSS / agg examples)                     |
| `50-maintenance.md`     | Hand-written                              | Rare (re-indexing guidance)                                             |
| `90-troubleshooting.md` | Hand-written                              | Rare (FAQ)                                                              |

Adding a new generated section: write a renderer, register it in `RENDERERS`, drop a placeholder `XX-name.gen.md` in the kind directory (the placeholder body is the offline-fallback prose). No assembler change.

## Pointer protocol and staleness detection

Every consumer-disk template carries an HTML-comment stamp:

```markdown
<!-- codemap-pointer-version: 1 -->
```

On every codemap invocation the runtime scans `<root>/.agents/{skills/codemap/SKILL,rules/codemap}.md` once and prints a single stderr nag when:

- Stamp present and `< EXPECTED_POINTER_VERSION` → "v0, expected v1".
- Stamp absent and file is "fat" (>50 lines) → treated as pre-pointer legacy.
- Stamp absent and file is short → silent (assumed user-managed override).

Cure: `codemap agents init --force` rewrites the bundled paths to current pointers. Should fire roughly once a year — only bump `EXPECTED_POINTER_VERSION` when the **shape** of the pointer file changes (frontmatter schema, fetch URI list, marker comments), not when the served content changes.

Warning goes to stderr only so `codemap skill > file.md` stays clean.

## Implementation (for contributors)

| Source                                     | Role                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`src/agents-template-path.ts`**          | **`resolveAgentsTemplateDir()`** — leaf bundled `templates/agents/` resolver; shared by init and `application/*` live-fetch without import cycles.                                                                                                                               |
| **`src/agents-init-targets.ts`**           | **`AgentsInitTarget`** + symlink-style integration ids — shared by init and MCP registry without import cycles.                                                                                                                                                                  |
| **`src/agents-init.ts`**                   | **`runAgentsInit`**, **`upsertCodemapPointerFile`**, **`listRegularFilesRecursive`**, **`applyAgentsInitTargets`** (per-file **`copyFileSync`** / **`symlinkFilesGranular`**), **`ensureGitignoreCodemapPattern`** (writes `<state-dir>/.gitignore`), **`targetsNeedLinkMode`**. |
| **`src/agents-init-mcp-registry.ts`**      | **`AGENTS_INIT_MCP_REGISTRY`** — paths, formats, defaults, docs URLs (source of truth for the MCP table below).                                                                                                                                                                  |
| **`src/codemap-invocation.ts`**            | PM-aware codemap CLI spawn resolution (`resolveCodemapCliInvocation`, `buildCodemapMcpSpawn`); shared with `scripts/codemap-invocation.mjs`.                                                                                                                                     |
| **`src/agents-init-mcp.ts`**               | **`applyAgentsInitMcp`**, JSON merge + post-write verify; **`--mcp`** side effect.                                                                                                                                                                                               |
| **`src/agents-init-interactive.ts`**       | **`@clack/prompts`** flow; calls **`runAgentsInit`**.                                                                                                                                                                                                                            |
| **`src/cli/cmd-agents.ts`**                | Lazy-loaded from **`src/cli/main.ts`**.                                                                                                                                                                                                                                          |
| **`src/cli/cmd-skill.ts`**                 | `codemap skill` / `codemap rule` verbs; thin wrapper over `assembleAgentContent(kind)`.                                                                                                                                                                                          |
| **`src/application/agent-content.ts`**     | `assembleAgentContent`, `RENDERERS` map, `renderRecipesSection`, `renderSchemaSection`, `checkConsumerPointers`, `maybeWarnStalePointers`, `EXPECTED_POINTER_VERSION`.                                                                                                           |
| **`src/application/resource-handlers.ts`** | `readSkill` / `readRule` (MCP + HTTP resource handlers; both delegate to `assembleAgentContent`).                                                                                                                                                                                |

Do **not** duplicate long IDE matrices, **`--force`** / pointer behavior, **`codemap-pointer`** details, section assembler shape, or pointer-version semantics in **README.md** or **packaging.md** — link **here** instead.

## Shipped agent & indexing milestones

Maintainer inventory — contracts live in [architecture.md](./architecture.md), [golden-queries.md](./golden-queries.md), and [glossary.md](./glossary.md); not duplicated on [roadmap.md](./roadmap.md).

**Wave 1–2** ([#126](https://github.com/stainless-code/codemap/pull/126)–[#138](https://github.com/stainless-code/codemap/pull/138)): MCP instructions, allowlist, WSL watch, git hooks, trace/explore/node, `agents init --mcp`, affected tests, index lock/`unlock`, parse-worker hardening, field-qualified search.

**Agent eval** ([#139](https://github.com/stainless-code/codemap/pull/139) probe + [#144](https://github.com/stainless-code/codemap/pull/144) live MCP arms + log comparison): see [benchmark § Agent eval harness](./benchmark.md#agent-eval-harness).

**Warm-path / bootstrap** — `index_freshness` on `context` / tool metadata / HTTP headers ([#149](https://github.com/stainless-code/codemap/pull/149)); `start_here` composer ([#151](https://github.com/stainless-code/codemap/pull/151)); adaptive output budgets ([#152](https://github.com/stainless-code/codemap/pull/152)); MCP session lifecycle ([#153](https://github.com/stainless-code/codemap/pull/153); **no MCP idle timeout** — [architecture § Session lifecycle](./architecture.md#session-lifecycle-wiring)); PM-aware MCP spawn ([#154](https://github.com/stainless-code/codemap/pull/154)); safer init re-runs ([#155](https://github.com/stainless-code/codemap/pull/155)); VS Code workspace root in MCP ([#156](https://github.com/stainless-code/codemap/pull/156)); `agents init --targets` ([#158](https://github.com/stainless-code/codemap/pull/158)).

## Related

- [architecture.md](./architecture.md) — CLI chunks, layering.
- [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) — **`.agents/`** + **`.cursor/`** wiring, **`main`** / PR workflow.
- [why-codemap.md](./why-codemap.md) — why SQL + index for agents.
