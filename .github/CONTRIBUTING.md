# Contributing

Codemap is in **bootstrap / extraction** phase. Before large PRs, please open an issue so we can align on:

- **Core vs adapter** — core should stay small; language-specific logic belongs in **adapters** (see [docs/roadmap.md](../docs/roadmap.md)).
- **Runtimes** — **Node** `^20.19.0 || >=22.12.0` and **Bun** `>=1.0.0` (`package.json` **engines**); SQLite is **`better-sqlite3`** on Node and **`bun:sqlite`** on Bun ([docs/architecture.md](../docs/architecture.md), [docs/packaging.md § Node vs Bun](../docs/packaging.md#node-vs-bun)).

## Dev workflow

```bash
bun install   # runs `prepare` → Husky git hooks
bun run dev   # same as `bun src/index.ts` — CLI from source
bun test
bun run check   # format + lint + tests + typecheck + build
bun run clean   # remove untracked/ignored build artifacts (keeps `.env`, `.codemap.db*`)
bun run check-updates   # interactive dependency updates (`bun update -i --latest`)
```

### `main` and pull requests

Branch **`main`** is **protected**: routine work does **not** push directly to `main`. Open a **pull request** and merge only after **[CI](workflows/ci.yml)** passes (format, lint, typecheck, test, build).

```bash
git fetch origin && git checkout main && git pull
git checkout -b your-branch-name
# … commit …
git push -u origin your-branch-name
```

Then open a PR on GitHub into **`main`**.

### Readability & DX

- **Public API** — Anything exported from the package entry (`src/index.ts` → `src/api.ts`, `config.ts`, shared types) should have **JSDoc** that reads well in hovers and in published typings.
- **Layers** — Keep boundaries clear: [architecture.md](../docs/architecture.md) (`cli` → `application` → infrastructure). Don’t let CLI concerns leak into parsers or the DB layer.
- **Before you open / update a PR** — `bun run check` (or at least `bun run test` + `bun run typecheck` while iterating).
- **Style** — Match Oxfmt/Oxlint; prefer **straight-line code** and extracted helpers over long nested blocks.

**Editor (VS Code):** [`.vscode/extensions.json`](../.vscode/extensions.json) lists recommended extensions (Bun, Oxc, TypeScript native preview, etc.). [`.vscode/settings.json`](../.vscode/settings.json) enables Oxc format on save and `tsgo`. Formatting and lint rules live in [`.oxfmtrc.json`](../.oxfmtrc.json) and [`.oxlintrc.json`](../.oxlintrc.json) (no framework-specific options beyond defaults).

**Git hooks:** [Husky](https://github.com/typicode/husky) + [lint-staged](https://github.com/lint-staged/lint-staged) — see [`.husky/pre-commit`](../.husky/pre-commit). Pre-commit runs **`lint-staged`** only when `CURSOR_AGENT`, `CLAUDECODE`, or `AI_AGENT` is set (AI/agent commits). Staged files get `oxfmt`, `oxlint`, staged-only **`tsgo`**, and **`bun test`** on `*.test.ts`.

### QA against a real app (testing bench)

Do **not** add Codemap as a dependency to the bench repo. In **this** repo, copy `.env.example` to `.env` and set **`CODEMAP_TEST_BENCH`** to an **absolute path** to the other clone, then run `bun src/index.ts` as usual. See [docs/benchmark.md § Indexing another project](../docs/benchmark.md#indexing-another-project).

Releases: **[@changesets/cli](https://github.com/changesets/changesets)** — run **`bun run changeset`** when your PR should bump the version; see [docs/packaging.md § Releases](../docs/packaging.md#releases).

**Issues:** use [GitHub issue templates](https://github.com/stainless-code/codemap/issues/new/choose) — **Core bug** vs **Adapter proposal** (see `.github/ISSUE_TEMPLATE/`).

## Agent rules and skills (`.agents/`)

**Upstream** skill and rules in this repo (e.g. `codemap`) stay **generic** — placeholder SQL and triggers, no product-specific paths. Consumer projects can run **`codemap agents init`** (ships **`templates/agents`** on npm) or **copy/symlink** manually, then **edit their copy** for team aliases and queries. Customization always belongs in the **consumer** repo.

Rules live under **`.agents/rules/`**; skills under **`.agents/skills/<name>/SKILL.md`**. Symlink each into **`.cursor/`** (see [agents-first-convention.mdc](../.agents/rules/agents-first-convention.mdc)):

```bash
mkdir -p .cursor/rules .cursor/skills
for f in codemap agents-first-convention no-bypass-hooks verify-after-each-step tracer-bullets concise-reporting; do
  ln -sf "../../.agents/rules/${f}.mdc" ".cursor/rules/${f}.mdc"
done
ln -sf ../../.agents/skills/codemap .cursor/skills/codemap
```

| Rule                          | Purpose                                   |
| ----------------------------- | ----------------------------------------- |
| `codemap.mdc`                 | Query SQLite index before structural grep |
| `agents-first-convention.mdc` | `.agents/` source + `.cursor/` symlinks   |
| `no-bypass-hooks.mdc`         | Never `--no-verify` on commit             |
| `verify-after-each-step.mdc`  | Run checks between milestones             |
| `tracer-bullets.mdc`          | Vertical slices end-to-end                |
| `concise-reporting.mdc`       | Short agent replies                       |

Thank you for helping make structural codebase queries fast and reusable for agents.
