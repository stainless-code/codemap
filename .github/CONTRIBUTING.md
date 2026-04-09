# Contributing

Codemap is in **bootstrap / extraction** phase. Before large PRs, please open an issue so we can align on:

- **Core vs adapter** — core should stay small; language-specific logic belongs in **adapters** (see [docs/roadmap.md](../docs/roadmap.md)).
- **Runtimes** — **Node** `^20.19.0 || >=22.12.0` and **Bun** `>=1.0.0` (`package.json` **engines**); SQLite is **`better-sqlite3`** on Node and **`bun:sqlite`** on Bun ([docs/architecture.md](../docs/architecture.md), [docs/packaging.md § Node vs Bun](../docs/packaging.md#node-vs-bun)).

## Dev workflow

```bash
bun install   # runs `prepare` → Husky git hooks
bun run dev   # same as `bun src/index.ts` — CLI from source
bun test
bun run test:golden   # golden SQL vs fixtures/minimal (also runs at end of `bun run check`)
bun run test:golden:external   # Tier B: local tree via CODEMAP_ROOT / --root (not in CI)
bun run check   # format + lint + tests + typecheck + build + test:golden
bun run clean   # remove untracked/ignored build artifacts (keeps `.env`, `.codemap.db*`)
bun run check-updates   # interactive dependency updates (`bun update -i --latest`)
```

### `main` and pull requests

Branch **`main`** is **protected**: routine work does **not** push directly to `main`. Open a **pull request** and merge only after **[CI](workflows/ci.yml)** passes.

**Required status checks:** Prefer requiring the single check **`CI complete`** (aggregates the matrix). PRs from **`changeset-release/<branch>`** (Changesets “Version packages”; see [changesets/action](https://github.com/changesets/action)) skip the heavy jobs here; per [GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging), **`skipped`** can still satisfy required checks — **`CI complete`** remains the clearest green/red signal. Ensure job **names** are unique across workflows ([docs](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#about-branch-protection-rules)).

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
- **Golden queries (Tier A)** — If you change `fixtures/minimal/` or schema/query behavior expected by [fixtures/golden/](../fixtures/golden/), run `bun scripts/query-golden.ts --update`, review diffs, and commit updated JSON under `fixtures/golden/minimal/`. Prefer **fixing the indexer** when output changes for the wrong reason; only refresh goldens when the new rows are correct. See [docs/golden-queries.md](../docs/golden-queries.md).
- **Golden queries (Tier B)** — Against a **local** clone, use `bun run test:golden:external` with `CODEMAP_ROOT` / `--root`. Copy [fixtures/golden/scenarios.external.example.json](../fixtures/golden/scenarios.external.example.json) to `scenarios.external.json` if you need custom scenarios; goldens under `fixtures/golden/external/` are gitignored — do not commit snapshots from proprietary trees.
- **Style** — Match Oxfmt/Oxlint; prefer **straight-line code** and extracted helpers over long nested blocks.

**Editor (VS Code):** [`.vscode/extensions.json`](../.vscode/extensions.json) lists recommended extensions (Bun, Oxc, TypeScript native preview, etc.). [`.vscode/settings.json`](../.vscode/settings.json) enables Oxc format on save and `tsgo`. Formatting and lint rules live in [`.oxfmtrc.json`](../.oxfmtrc.json) and [`.oxlintrc.json`](../.oxlintrc.json) (no framework-specific options beyond defaults).

**Git hooks:** [Husky](https://github.com/typicode/husky) + [lint-staged](https://github.com/lint-staged/lint-staged) — see [`.husky/pre-commit`](../.husky/pre-commit). Pre-commit runs **`lint-staged`** only when `CURSOR_AGENT`, `CLAUDECODE`, or `AI_AGENT` is set (AI/agent commits). Staged files get `oxfmt`, `oxlint`, staged-only **`tsgo`**, and **`bun test`** on `*.test.ts`.

### QA against a real app (testing bench)

Do **not** add Codemap as a dependency to the bench repo. In **this** repo, copy `.env.example` to `.env` and set **`CODEMAP_TEST_BENCH`** to an **absolute path** to the other clone, then run `bun src/index.ts` as usual. See [docs/benchmark.md § Indexing another project](../docs/benchmark.md#indexing-another-project).

**One-shot QA (index + disk checks + benchmark):** `CODEMAP_ROOT=/absolute/path/to/app bun run qa:external` (or set **`CODEMAP_TEST_BENCH`** in `.env`; optional `--root` overrides). Optional **`--max-files`** / **`--max-symbols`** (positive integers; default caps sampling). Validates indexed paths exist, spot-checks symbol lines vs files, prints sample SQL rows, then runs `src/benchmark.ts`. Do **not** add external app source into this repository.

Releases: **[@changesets/cli](https://github.com/changesets/changesets)** — run **`bun run changeset`** when your PR should bump the version; see [docs/packaging.md § Releases](../docs/packaging.md#releases).

**Issues:** use [GitHub issue templates](https://github.com/stainless-code/codemap/issues/new/choose) — **Core bug** vs **Adapter proposal** (see `.github/ISSUE_TEMPLATE/`).

## Agent rules and skills (`.agents/`)

**Upstream** skill and rules in this repo (e.g. `codemap`) stay **generic** — placeholder SQL and triggers, no product-specific paths. Consumer projects can run **`codemap agents init`** (ships **`templates/agents`** on npm; see [docs/agents.md](../docs/agents.md)) or **copy/symlink** manually, then **edit their copy** for team aliases and queries. Customization always belongs in the **consumer** repo.

Rules live under **`.agents/rules/`** as `.md` files; skills under **`.agents/skills/<name>/SKILL.md`**. Symlink into **`.cursor/`** with `.mdc` extension (Cursor requires `.mdc` for frontmatter parsing; see [agents-first-convention.md](../.agents/rules/agents-first-convention.md)):

```bash
mkdir -p .cursor/rules .cursor/skills
for f in codemap agents-first-convention no-bypass-hooks verify-after-each-step tracer-bullets concise-reporting; do
  ln -sf "../../.agents/rules/${f}.md" ".cursor/rules/${f}.mdc"
done
ln -sf ../../.agents/skills/codemap .cursor/skills/codemap
```

| Rule                         | Purpose                                   |
| ---------------------------- | ----------------------------------------- |
| `codemap.md`                 | Query SQLite index before structural grep |
| `agents-first-convention.md` | `.agents/` source + `.cursor/` symlinks   |
| `no-bypass-hooks.md`         | Never `--no-verify` on commit             |
| `verify-after-each-step.md`  | Run checks between milestones             |
| `tracer-bullets.md`          | Vertical slices end-to-end                |
| `concise-reporting.md`       | Short agent replies                       |

Thank you for helping make structural codebase queries fast and reusable for agents.
