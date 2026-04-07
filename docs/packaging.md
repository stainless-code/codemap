# Packaging

How **@stainless-code/codemap** is built and published. Hub: [README.md](./README.md).

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

[**Changesets**](https://github.com/changesets/changesets): **`bun run changeset`** → commit **`.changeset/`** → merge → [release workflow](../.github/workflows/release.yml) opens the **Version packages** PR and, after that lands, can publish to npm.

**GitHub Actions:** On **every push to `main`**, [release.yml](../.github/workflows/release.yml) runs. If there are **pending** `.changeset/*.md` files, the action only needs **`GITHUB_TOKEN`** to open/update the Version PR. If there are **no** pending changesets (e.g. a docs-only merge), the action can still run **`bun run release`** (`changeset publish`) so a **just-merged** Version PR can publish — when there is **nothing** to publish, that command should **exit 0**. **`NPM_TOKEN`** (npm [automation token](https://docs.npmjs.com/creating-and-viewing-access-tokens)) must be set as a repo secret for **real** publishes; without it, `changeset publish` may fail in CI (e.g. registry checks). If the Release job fails, use the workflow log to see the real error rather than guessing the cause.

## Related

- [architecture.md](./architecture.md) — schema, layering, API.
