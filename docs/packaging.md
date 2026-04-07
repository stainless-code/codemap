# Packaging

How **@stainless-code/codemap** is built and published. **Doc index:** [README.md](./README.md). **Runtime comparison table:** [§ Node vs Bun](#node-vs-bun) — link from other docs; do not duplicate the table.

## Build & publish surface

- **`bun run build`** → **tsdown** (`tsdown.config.ts`) → **`dist/`** (main **`index.mjs`**, lazy CLI chunks from **`src/cli/main.ts`**, workers, shared chunks) + types. **`prepublishOnly`** runs build.
- **`package.json`**: **`bin`** and **`exports`** → **`./dist/index.mjs`**; **`files`**: **`CHANGELOG.md`**, **`dist/`**, **`templates/`** — no `src/` on npm.

## Consuming locally

Published tarballs match **`package.json` `files`**: **`CHANGELOG.md`**, **`dist/`**, **`templates/`** (no `src/`). **`bun run pack`**, then point the consumer at **`file:…/stainless-code-codemap-*.tgz`**, or use **`file:/path/to/repo`** after build, or **`bun link`**. If **`better-sqlite3`** fails in the consumer, **`npm rebuild better-sqlite3`** (native addon must match that Node).

**Engines** (`package.json`): **Node** `^20.19.0 || >=22.12.0` (matches **`oxc-parser`**; **`better-sqlite3`** is prebuilt for current Node majors only). **Bun** `>=1.0.0`. **Native bindings:** `better-sqlite3`, `lightningcss`, `oxc-parser`, `oxc-resolver` (NAPI); **`fast-glob`** and **`zod`** are JS-only. **`zod`** validates `codemap.config.*` at runtime (**`codemapUserConfigSchema`** in **`src/config.ts`**); see [architecture.md § User config](./architecture.md#user-config).

## Node vs Bun

Same schema and CLI; implementation differs by runtime. Details: [architecture.md § Runtime and database](./architecture.md#runtime-and-database).

| Concern       | Bun                               | Node                                          |
| ------------- | --------------------------------- | --------------------------------------------- |
| SQLite        | **`bun:sqlite`** (`sqlite-db.ts`) | **`better-sqlite3`**                          |
| Workers       | **`Worker`** → `parse-worker.ts`  | **`worker_threads`** → `parse-worker-node.ts` |
| Include globs | **`Glob`** (`glob-sync.ts`)       | **`fast-glob`**                               |
| JSON config   | **`Bun.file(…).json()`**          | **`readFile` + `JSON.parse`** (`config.ts`)   |

**`db.ts`** does not import **`bun:sqlite`**. Upstream API: [Bun SQLite](https://bun.com/docs/api/sqlite). No **`bun build --compile`** shipping — see [Bun executables](https://bun.sh/docs/bundler/executables).

**`runSql()`:** **`better-sqlite3`** is one statement per prepare; **`bun:sqlite`** accepts multiple. On Node only, **`runSql()`** splits on **`;`**. Do not put **`;`** inside **`--`** line comments in **`db.ts`** DDL.

## Releases

Releases use [**Changesets**](https://github.com/changesets/changesets). Repo config: [`.changeset/config.json`](../.changeset/config.json) (`$schema` targets **`@changesets/config`** — resolved version in **`bun.lock`**). Upstream CLI docs: [`.changeset/README.md`](../.changeset/README.md).

| Step | What happens                                                                                                                                                                                                                                                                                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **`bun run changeset`** — add a changeset file under **`.changeset/`**, commit, open PR to **`main`**.                                                                                                                                                                                                                                                    |
| 2    | **Merge** — on every push to **`main`**, [`.github/workflows/release.yml`](../.github/workflows/release.yml) runs [`changesets/action@v1`](https://github.com/changesets/action): opens/updates the **Version packages** PR when pending changesets exist; **`publish: bun run release`** runs **`changeset publish`**; **`createGithubReleases: true`**. |
| 3    | **Secrets** — **`GITHUB_TOKEN`** is provided by Actions. **`NPM_TOKEN`** (npm [automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens)) must be a **repository secret** for publishes to npm. If the Release job fails, use the workflow log (missing token, registry error, etc.) — don’t assume the cause from the job name alone. |

## Related

- [architecture.md](./architecture.md) — schema, layering, API, user config.
- [agents.md](./agents.md) — **`templates/agents`**, **`codemap agents init`** (CLI flags and file behavior documented there), published **`files`** surface above.
- [benchmark.md](./benchmark.md) — external roots, **`CODEMAP_ROOT`**, benchmark script.
