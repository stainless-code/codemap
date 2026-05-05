# Codemap

> SQL-queryable structural index of your codebase. Run any predicate as a recipe; CI gating via SARIF → Code Scanning.

Codemap indexes your repository's structure into a local SQLite database (symbols, imports, exports, components, dependencies, type members, calls, markers, CSS variables, classes, keyframes) and lets you query it with raw SQL or one of the bundled "recipes" (saved queries). The Action runs codemap on every PR, diffs the structure against the base branch, and surfaces the results in GitHub Code Scanning + an optional PR-conversation comment.

**No AI inside. No telemetry. No verdicts.** Codemap supplies the facts; your reviewers (human or agent) decide what to do with them.

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
          fetch-depth: 0 # so `audit --base ${{ github.base_ref }}` can see the base ref
      - uses: stainless-code/codemap@v1
```

That's it. On every PR, the Action runs `codemap audit --base ${{ github.base_ref }} --ci`, emits a SARIF 2.1.0 doc, and uploads it to GitHub Code Scanning. Findings show up inline on the diff. Failing findings exit non-zero so the runner step fails the check.

## What you get on a PR

- **Structural drift** as SARIF — three deltas surface as Code Scanning rules: `codemap.audit.files-added`, `codemap.audit.dependencies-added`, `codemap.audit.deprecated-added`.
- **PR-line annotations** for each new finding (auto-detected from `file_path` / `path` / `to_path` / `from_path`).
- **Optional PR-summary comment** (`pr-comment: true`) — markdown comment with collapsed `<details>` sections per delta, useful for repos without GitHub Advanced Security or for bot-context seeding (review bots read PR conversation, not workflow artifacts).

## Configuration

All inputs are optional. The defaults work for the headline use case (PR-scoped audit on `pull_request` events; no-op on other events).

| Input               | Default                                      | Description                                                                                                                                              |
| ------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `working-directory` | `.`                                          | Subdirectory to run codemap in (for monorepos).                                                                                                          |
| `package-manager`   | _autodetect_                                 | Override autodetect: `npm` / `pnpm` / `yarn` / `yarn@berry` / `bun`. Empty = auto via `package-manager-detector`.                                        |
| `version`           | _project devDep → latest_                    | Pin codemap CLI version (e.g. `0.5.0`). Empty = use the project's devDependency if present, else fall back to `<pm> dlx @stainless-code/codemap@latest`. |
| `state-dir`         | _codemap default (`.codemap/`)_              | Override codemap state directory location.                                                                                                               |
| `mode`              | `audit`                                      | `audit` / `recipe` / `command`. (`aggregate` reserved for v1.x.)                                                                                         |
| `recipe`            | _empty_                                      | Recipe id (when `mode: recipe`). List with `codemap query --recipes-json`.                                                                               |
| `params`            | _empty_                                      | Recipe params for parametrised recipes; multiline `key=value` pairs.                                                                                     |
| `baseline`          | _empty_                                      | Saved baseline name to diff against (when `mode: recipe`).                                                                                               |
| `audit-base`        | _`github.base_ref` on `pull_request` events_ | Git ref to audit against. Empty + non-PR event → action no-ops.                                                                                          |
| `changed-since`     | _empty_                                      | Filter results to files changed since the given git ref.                                                                                                 |
| `group-by`          | _empty_                                      | Bucket results by `owner` (CODEOWNERS) / `directory` / `package` (workspace package).                                                                    |
| `command`           | _empty_                                      | Raw CLI args (escape hatch). When set, overrides every `mode: …` input.                                                                                  |
| `format`            | `sarif`                                      | `sarif` / `json` / `annotations` / `mermaid` / `diff` (per-mode availability varies).                                                                    |
| `output-path`       | `codemap.sarif`                              | Where to write the output file.                                                                                                                          |
| `upload-sarif`      | `true`                                       | Upload the SARIF artifact to GitHub Code Scanning. Set `false` if your repo can't use Code Scanning.                                                     |
| `pr-comment`        | `false`                                      | Post a markdown summary comment on the PR. Set `true` to enable. Useful when SARIF→Code-Scanning isn't available or for bot-context seeding.             |
| `fail-on`           | `any`                                        | Exit-code policy: `any` (fail when any finding) / `never` (no exit code).                                                                                |
| `token`             | _`github.token`_                             | GitHub token for SARIF upload + PR comment posting.                                                                                                      |

## Examples

**Run a single recipe instead of the audit:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    mode: recipe
    recipe: deprecated-symbols
```

**Post a PR comment in addition to the SARIF upload (private repos without GitHub Advanced Security):**

```yaml
- uses: stainless-code/codemap@v1
  with:
    pr-comment: true
    upload-sarif: false # if Code Scanning isn't available, skip the upload
```

**Group findings by CODEOWNERS team:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    mode: recipe
    recipe: untested-and-dead
    group-by: owner
```

**Run a parametrised recipe with explicit params:**

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

**Escape hatch for arbitrary CLI invocations:**

```yaml
- uses: stainless-code/codemap@v1
  with:
    command: "query --recipe boundary-violations --format sarif"
```

## Outputs

| Output           | Description                                                           |
| ---------------- | --------------------------------------------------------------------- |
| `agent`          | Resolved package manager (`npm` / `pnpm` / `yarn` / `bun`).           |
| `exec`           | Shell-ready command used to invoke codemap.                           |
| `install_method` | `project-installed` / `dlx-pinned` / `dlx-latest` (debug breadcrumb). |
| `output-file`    | Path to the written output file (echoes `inputs.output-path`).        |

## Permissions

Default permissions for the workflow:

- `contents: read` — required to check out the repo.
- `security-events: write` — required when `upload-sarif: true` (default), so the SARIF artifact uploads to Code Scanning.
- `pull-requests: write` — required when `pr-comment: true`, so the Action can post a comment on the PR.

If your workflow already has a broader `permissions:` block, no changes are needed.

## How it works

The Action is a thin composite wrapper. Steps in order:

1. **Skip-on-non-PR-events** — without `command:` set, the action no-ops with a friendly log message on `push` / `schedule` / `workflow_dispatch`.
2. **Setup Node.js** — for the package-manager-detection script.
3. **Detect package manager + resolve CLI invocation** — delegates to [`package-manager-detector`](https://github.com/antfu-collective/package-manager-detector). Tries (in order): explicit `package-manager:` input → `package.json#packageManager` field → `devEngines.packageManager` field → lockfile (`bun.lock` / `pnpm-lock.yaml` / `yarn.lock` / `package-lock.json`) → install-metadata → walk-up to parent dir → `npm` fallback. Then resolves whether to invoke the project-installed binary, a pinned `dlx`, or `dlx-latest`.
4. **Validate inputs** — `mode: recipe` without `recipe:` is a hard error; `mode: command` without `command:` is a hard error; `mode: aggregate` is reserved for v1.x.
5. **Run codemap** — `<resolved-cli> <args>` based on `mode:` / `command:` inputs. Output → `output-path`.
6. **Upload SARIF** (if `upload-sarif: true` and `format: sarif`) — `github/codeql-action/upload-sarif@v3` pushes to Code Scanning.
7. **Post PR comment** (if `pr-comment: true` and event is `pull_request`) — pipes the output through `codemap pr-comment` to render a markdown summary, then posts via `gh pr comment`.

The CLI itself is published to npm as [`@stainless-code/codemap`](https://www.npmjs.com/package/@stainless-code/codemap). The Action's binary resolution prefers the project-installed version when present so the codemap binary running in CI matches the one running locally.

## Versioning

This Action publishes at its own `v1.0.0`, independent of the codemap CLI's npm version. The `@v1` floating tag advances with every minor/patch release; pin to `@v1.2.3` for exact reproducibility.

## Limitations

- Default audit command runs only on `pull_request` events. Pass an explicit `command:` to invoke on other events.
- SARIF → Code Scanning upload requires GitHub Advanced Security on private repos. Without GHAS, set `upload-sarif: false` and rely on `pr-comment: true` for review-surface visibility.
- `mode: aggregate` (run audit + curated recipes in one invocation) is reserved for v1.x.

## Source + license

- Repository: [stainless-code/codemap](https://github.com/stainless-code/codemap)
- Documentation: [docs/](https://github.com/stainless-code/codemap/tree/main/docs)
- Issues: [GitHub Issues](https://github.com/stainless-code/codemap/issues)
- License: MIT
