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
codemap agents init --git-hooks       # opt-in background index on git events
codemap agents init --no-git-hooks    # remove codemap hook blocks
```

- **`--force`** — if **`.agents/`** already exists, delete only the **same file paths** that ship in **`templates/agents`** (under **`rules/`** and **`skills/`**), then copy those files from the template. Any **other** files next to them (your custom rules, extra skill dirs, notes at **`.agents/`** root, etc.) are **not** removed. Use **`--interactive`**, not a bare **`interactive`** argument (unknown tokens are rejected).
- **`--interactive`** — multiselect which tools to wire (see below); choose **symlink** vs **copy** for integrations that mirror **`.agents/rules`** (and Cursor also **`.agents/skills`**). Uses [**@clack/prompts**](https://github.com/bombshell-dev/clack); **non-TTY** runs exit with an error.

## Git and `.gitignore`

Codemap maintains its own self-managed **`<state-dir>/.gitignore`** (default `.codemap/.gitignore`) — a blacklist of generated artifacts (`index.db` + WAL/SHM, `audit-cache/`) reconciled to canonical on every codemap boot via `ensureStateGitignore` (`src/application/state-dir.ts`). Project-tracked sources (`recipes/`, `config.{ts,js,json}`) default to tracked.

The user's root **`.gitignore`** is no longer touched by `codemap agents init`. Future codemap versions can add new generated artifacts to the canonical blacklist; every consumer's project repairs itself on the next `codemap` invocation. **The setup logic IS the migration** (per plan §D11).

## Optional IDE / tool wiring

All integrations reuse the **same** bundled content under **`.agents/`**. Symlink-style rows use one **link mode** for the whole run (**symlink** or **copy**) when any of them is selected.

| Integration                           | What gets created                                          | Notes                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**                            | **`.cursor/rules`**, **`.cursor/skills`** → **`.agents/`** | Per-file symlink or copy (each rule/skill file, not a directory link).                                                              |
| **Windsurf**                          | **`.windsurf/rules`** → **`.agents/rules`**                | Rules only.                                                                                                                         |
| **Continue**                          | **`.continue/rules`** → **`.agents/rules`**                | [Continue rules](https://docs.continue.dev/customize/rules).                                                                        |
| **Cline**                             | **`.clinerules`** → **`.agents/rules`**                    | Per-file symlink or copy.                                                                                                           |
| **Amazon Q**                          | **`.amazonq/rules`** → **`.agents/rules`**                 | [AWS rules](https://aws.amazon.com/blogs/devops/mastering-amazon-q-developer-with-rules/).                                          |
| **GitHub Copilot**                    | **`.github/copilot-instructions.md`**                      | Pointer + link to [GitHub Docs](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot). |
| **Claude Code**                       | **`CLAUDE.md`**                                            | Root onboarding pointer.                                                                                                            |
| **Zed / JetBrains / Aider (generic)** | **`AGENTS.md`**                                            | Many tools read root **`AGENTS.md`**; JetBrains/Aider have no single mandated path — this file is the shared hook.                  |
| **Gemini**                            | **`GEMINI.md`**                                            | For integrations that load **`GEMINI.md`**.                                                                                         |

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
| **`--force`**                                                                | Replace the **entire file** with the latest managed section.                                                  |

Append alone would duplicate on every run — markers + replace are what prevent duplicates and staleness.

## Live fetch surface (CLI + MCP + HTTP)

Once `agents init` has written the pointer templates, the consumer's disk holds 12–20 lines per file. The actual content is served live:

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

## MCP tool allowlist

**`CODEMAP_MCP_TOOLS`** — comma-separated snake_case MCP tool names. When set, only listed tools register (stderr lists the active set). Unknown names are ignored with a warning. Unset = all tools (default). **`query_batch`** registers only when listed or when unset (eval ablation).

Example: `CODEMAP_MCP_TOOLS=query,context,show codemap mcp --no-watch`

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
| **`src/agents-init.ts`**                   | **`runAgentsInit`**, **`upsertCodemapPointerFile`**, **`listRegularFilesRecursive`**, **`applyAgentsInitTargets`** (per-file **`copyFileSync`** / **`symlinkFilesGranular`**), **`ensureGitignoreCodemapPattern`** (writes `<state-dir>/.gitignore`), **`targetsNeedLinkMode`**. |
| **`src/agents-init-interactive.ts`**       | **`@clack/prompts`** flow; calls **`runAgentsInit`**.                                                                                                                                                                                                                            |
| **`src/cli/cmd-agents.ts`**                | Lazy-loaded from **`src/cli/main.ts`**.                                                                                                                                                                                                                                          |
| **`src/cli/cmd-skill.ts`**                 | `codemap skill` / `codemap rule` verbs; thin wrapper over `assembleAgentContent(kind)`.                                                                                                                                                                                          |
| **`src/application/agent-content.ts`**     | `assembleAgentContent`, `RENDERERS` map, `renderRecipesSection`, `renderSchemaSection`, `checkConsumerPointers`, `maybeWarnStalePointers`, `EXPECTED_POINTER_VERSION`.                                                                                                           |
| **`src/application/resource-handlers.ts`** | `readSkill` / `readRule` (MCP + HTTP resource handlers; both delegate to `assembleAgentContent`).                                                                                                                                                                                |

Do **not** duplicate long IDE matrices, **`--force`** / pointer behavior, **`codemap-pointer`** details, section assembler shape, or pointer-version semantics in **README.md** or **packaging.md** — link **here** instead.

## Related

- [architecture.md](./architecture.md) — CLI chunks, layering.
- [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) — **`.agents/`** + **`.cursor/`** wiring, **`main`** / PR workflow.
- [why-codemap.md](./why-codemap.md) — why SQL + index for agents.
