# Packaging

How **@stainless-code/codemap** is built and consumed on npm.

## Build output

- **`bun run build`** runs **tsdown** (see `tsdown.config.ts`).
- Artifacts **`dist/`**: main bundle **`index.mjs`**, declaration **`index.d.mts`**, and **worker** chunks (`parse-worker*.mjs`) used by the indexer.
- **`prepublishOnly`** runs the build so publishes always include fresh `dist/`.

## Entry points

| Surface             | Location                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CLI**             | `package.json` → `"bin": { "codemap": "./dist/index.mjs" }` — same file as the library entry; **shebang** prepended at build time (tsdown `banner`) for `npx` / `node_modules/.bin`. |
| **Library**         | `"exports"` / `"main"` / `"types"` → **`./dist/index.mjs`** and **`./dist/index.d.mts`** — `createCodemap`, `Codemap`, `defineConfig`, config types, `runCodemapIndex`, etc.         |
| **Published files** | `package.json` → `"files": ["dist"]` — `src/` is not published.                                                                                                                      |

## Install

- **npm / pnpm / yarn / bun** install the package; **Node ≥20** and/or **Bun ≥1.1** (`engines` in `package.json`).

## Node vs Bun

One schema and SQL surface; backend is chosen in **`src/sqlite-db.ts`**: **`better-sqlite3`** on Node, **`bun:sqlite`** on Bun. **`src/db.ts`** does not import `bun:sqlite` directly. Workers: **`src/worker-pool.ts`** (Bun `Worker` vs Node `worker_threads`). More detail: [architecture.md § Runtime and database](./architecture.md#runtime-and-database). Bun’s **`bun:sqlite`** API (constructors, options): [bun-reference.md](./bun-reference.md).

| Track        | Where                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **CI**       | `node dist/index.mjs query "SELECT 1"` after build ([`ci.yml`](../.github/workflows/ci.yml)).          |
| **Optional** | Extra matrix (more Node versions, Bun smoke); changelog note if **`engines`** or SQLite stack changes. |

## Releases

Versioning and **`CHANGELOG.md`** use [**Changesets**](https://github.com/changesets/changesets). Changelog entries are generated with [**`@changesets/changelog-github`**](https://github.com/changesets/changesets/tree/main/packages/changelog-github) (links to PRs/commits on **`stainless-code/codemap`**). The release workflow passes **`GITHUB_TOKEN`** so `changeset version` can resolve those links in CI. For **`changeset version` locally**, set **`GITHUB_TOKEN`** (e.g. a [fine-grained PAT](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)) if you want the same links in the generated changelog.

1. **`bun run changeset`** — describe the change and semver bump; commit the generated file under **`.changeset/`**.
2. Merge the PR — on **`main`**, [`.github/workflows/release.yml`](../.github/workflows/release.yml) opens a **Version packages** PR (or publishes if versions are ready).
3. **`bun run release`** — runs **`changeset publish`** (used by CI). **`prepublishOnly`** runs **`bun run build`** before publish.

**GitHub Releases:** [`.github/workflows/release.yml`](../.github/workflows/release.yml) uses [`changesets/action`](https://github.com/changesets/action) with **`createGithubReleases: true`**, so a **GitHub Release** is created for each published package version when **`changeset publish`** succeeds (same step as npm publish).

**npm from CI:** add an **`NPM_TOKEN`** [repository secret](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions). Without it, the Version PR can still be opened/updated, but **npm publish (and thus GitHub Release creation) will not run** for that publish step.

## Related

- [architecture.md](./architecture.md) — schema, layering, CLI, programmatic API.
