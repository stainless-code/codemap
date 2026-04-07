# Agent templates and `codemap agents init`

Hub: [README.md](./README.md). **Package layout:** [packaging.md](./packaging.md) (`templates/` on npm). **CLI layering:** [architecture.md § Key Files](./architecture.md#key-files).

## What it does

The published package ships **`templates/agents/`** (rules + skills; mirrored in this repo under [`.agents/`](../.agents/)). The command **`codemap agents init`** copies that tree into **`<project>/.agents/`** — the **canonical** copy consumers edit (SQL, team conventions, paths).

```bash
codemap agents init
codemap agents init --force
codemap agents init --interactive   # or -i; requires a TTY
```

- **`--force`** — replace an existing **`.agents/`** directory.
- **`--interactive`** — multiselect which tools to wire (see below); choose **symlink** vs **copy** for integrations that mirror **`.agents/rules`** (and Cursor also **`.agents/skills`**). Uses [**@clack/prompts**](https://github.com/bombshell-dev/clack); **non-TTY** runs exit with an error.

## Git and `.gitignore`

If **`<project>/.git`** exists, Codemap ensures **`.codemap.*`** is listed so SQLite artifacts (e.g. **`.codemap.db`**, WAL/SHM) stay untracked:

- No **`.gitignore`** → create one containing **`.codemap.*`**.
- **`.gitignore`** exists → append **`.codemap.*`** once if missing.

If the project is **not** a Git working tree, **`.gitignore`** is not created.

## Optional IDE / tool wiring

All integrations reuse the **same** bundled content under **`.agents/`**. Symlink-style rows use one **link mode** for the whole run (**symlink** or **copy**) when any of them is selected.

| Integration                           | What gets created                                          | Notes                                                                                                                               |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Cursor**                            | **`.cursor/rules`**, **`.cursor/skills`** → **`.agents/`** | Symlink or copy both trees.                                                                                                         |
| **Windsurf**                          | **`.windsurf/rules`** → **`.agents/rules`**                | Rules only.                                                                                                                         |
| **Continue**                          | **`.continue/rules`** → **`.agents/rules`**                | [Continue rules](https://docs.continue.dev/customize/rules).                                                                        |
| **Cline**                             | **`.clinerules`** → **`.agents/rules`**                    | Directory symlink/copy.                                                                                                             |
| **Amazon Q**                          | **`.amazonq/rules`** → **`.agents/rules`**                 | [AWS rules](https://aws.amazon.com/blogs/devops/mastering-amazon-q-developer-with-rules/).                                          |
| **GitHub Copilot**                    | **`.github/copilot-instructions.md`**                      | Pointer + link to [GitHub Docs](https://docs.github.com/copilot/customizing-copilot/adding-custom-instructions-for-github-copilot). |
| **Claude Code**                       | **`CLAUDE.md`**                                            | Root onboarding pointer.                                                                                                            |
| **Zed / JetBrains / Aider (generic)** | **`AGENTS.md`**                                            | Many tools read root **`AGENTS.md`**; JetBrains/Aider have no single mandated path — this file is the shared hook.                  |
| **Gemini**                            | **`GEMINI.md`**                                            | For integrations that load **`GEMINI.md`**.                                                                                         |

Pointer files (**`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`**, Copilot instructions) are **skipped** if the file already exists unless **`--force`** (then overwritten where applicable).

## Implementation (for contributors)

| Source                               | Role                                                                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`src/agents-init.ts`**             | Copy **`templates/agents`** → **`.agents/`**, **`applyAgentsInitTargets`**, **`ensureGitignoreCodemapPattern`**, exported **`targetsNeedLinkMode`**. |
| **`src/agents-init-interactive.ts`** | **`@clack/prompts`** flow; calls **`runAgentsInit`**.                                                                                                |
| **`src/cli/cmd-agents.ts`**          | Lazy-loaded from **`src/cli/main.ts`**.                                                                                                              |

Do **not** duplicate long IDE matrices in **README.md** or **packaging.md** — link **here** instead.

## Related

- [architecture.md](./architecture.md) — CLI chunks, layering.
- [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) — Cursor symlink notes, **`main`** / PR workflow.
- [why-codemap.md](./why-codemap.md) — why SQL + index for agents.
