---
"@stainless-code/codemap": patch
---

**`codemap agents init`:** For Git repos, ensure **`.codemap.*`** is in **`.gitignore`** (create the file or append the line once). **`--force`** removes only template file paths (same relpaths under **`.agents/rules/`** and **`.agents/skills/`** as **`templates/agents`**) before merging; other files under **`.agents/`**, **`rules/`**, or **`skills/`** are kept. **`--interactive` / `-i`** — pick IDE integrations (Cursor, GitHub Copilot, Windsurf, Continue, Cline, Amazon Q, **`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`**) and symlink vs copy for rule mirrors; requires a TTY. Unknown positional arguments (e.g. `interactive` without `--interactive`) are rejected. Depends on **`@clack/prompts`**.

**Docs:** **[`docs/agents.md`](https://github.com/stainless-code/codemap/blob/main/docs/agents.md)**; **[`docs/README.md`](https://github.com/stainless-code/codemap/blob/main/docs/README.md)** index updated. Root **[`.gitignore`](https://github.com/stainless-code/codemap/blob/main/.gitignore)** uses a single **`.codemap.*`** line.
