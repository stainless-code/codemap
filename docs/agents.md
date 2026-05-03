# Agent templates and `codemap agents init`

**Doc index:** [README.md](./README.md). **Package layout:** [packaging.md](./packaging.md) (`templates/` on npm). **CLI layering:** [architecture.md § Key Files](./architecture.md#key-files).

## What it does

The published package ships **`templates/agents/`** (rules + skills). This repo also has [`.agents/`](../.agents/) for **Codemap development** (CLI from source); it is **not** identical to **`templates/agents/`** for every file (e.g. the **codemap** rule/skill). The command **`codemap agents init`** writes each bundled template file into **`<project>/.agents/`** with per-file copies (not a wholesale directory sync) — the **canonical** copy consumers edit (SQL, team conventions, paths).

**Maintenance discipline:** Core CLI / schema / recipe changes must update **both** copies of the codemap rule + skill in the same PR — see [README.md Rule 10](./README.md). Drift between `templates/agents/` and `.agents/` should be CLI-prefix-only (`codemap` vs `bun src/index.ts`).

**Query examples** in the bundled **codemap** rule and skill lead with **`codemap query --json`** (agents and automation). Omit **`--json`** when you want **`console.table`** in a terminal — see [README.md § CLI](../README.md#cli).

```bash
codemap agents init
codemap agents init --force
codemap agents init --interactive   # or -i; requires a TTY
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

## Implementation (for contributors)

| Source                               | Role                                                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`src/agents-init.ts`**             | **`runAgentsInit`**, **`upsertCodemapPointerFile`**, **`listRegularFilesRecursive`**, **`applyAgentsInitTargets`** (per-file **`copyFileSync`** / **`symlinkFilesGranular`**), **`ensureGitignoreCodemapPattern`**, **`targetsNeedLinkMode`**. |
| **`src/agents-init-interactive.ts`** | **`@clack/prompts`** flow; calls **`runAgentsInit`**.                                                                                                                                                                                          |
| **`src/cli/cmd-agents.ts`**          | Lazy-loaded from **`src/cli/main.ts`**.                                                                                                                                                                                                        |

Do **not** duplicate long IDE matrices, **`--force`** / pointer behavior, or **`codemap-pointer`** details in **README.md** or **packaging.md** — link **here** instead.

## Related

- [architecture.md](./architecture.md) — CLI chunks, layering.
- [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) — **`.agents/`** + **`.cursor/`** wiring, **`main`** / PR workflow.
- [why-codemap.md](./why-codemap.md) — why SQL + index for agents.
