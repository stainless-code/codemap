# @stainless-code/codemap

## 0.1.2

### Patch Changes

- [#4](https://github.com/stainless-code/codemap/pull/4) [`0a9d829`](https://github.com/stainless-code/codemap/commit/0a9d82935e775edfb942029c03b8a427f18f9e71) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - **`codemap agents init`:** For Git repos, ensure **`.codemap.*`** is in **`.gitignore`** (create the file or append the line once). **`--force`** removes only template file paths (same relpaths under **`.agents/rules/`** and **`.agents/skills/`** as **`templates/agents`**) before merging; other files under **`.agents/`**, **`rules/`**, or **`skills/`** are kept. **`--interactive` / `-i`** — pick IDE integrations (Cursor, GitHub Copilot, Windsurf, Continue, Cline, Amazon Q, **`CLAUDE.md`**, **`AGENTS.md`**, **`GEMINI.md`**) and symlink vs copy for rule mirrors; requires a TTY. Unknown positional arguments (e.g. `interactive` without `--interactive`) are rejected. Depends on **`@clack/prompts`**.

  **Docs:** **[`docs/agents.md`](https://github.com/stainless-code/codemap/blob/main/docs/agents.md)**; **[`docs/README.md`](https://github.com/stainless-code/codemap/blob/main/docs/README.md)** index updated. Root **[`.gitignore`](https://github.com/stainless-code/codemap/blob/main/.gitignore)** uses a single **`.codemap.*`** line.

## 0.1.1

### Patch Changes

- [#1](https://github.com/stainless-code/codemap/pull/1) [`b366c53`](https://github.com/stainless-code/codemap/commit/b366c532999800a1c0bb6e81aa68e6e8867baf83) Thanks [@SutuSebastian](https://github.com/SutuSebastian)! - Consolidate docs (index hub, packaging/Releases, benchmark vs external root), point `.changeset/README` at packaging, and add `clean` / `check-updates` npm scripts.

## 0.1.0

### Minor Changes

- Initial release (**0.1.0**): structural SQLite index, CLI (`codemap`, `query`), programmatic API, Zod-validated `codemap.config`, Bun and Node support.
