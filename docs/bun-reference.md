# Bun reference

Pointers to **Bun’s** docs ([bun.com/docs](https://bun.com/docs), [bun.com/docs/llms.txt](https://bun.com/docs/llms.txt)). Codemap uses **`bun:sqlite`** only when the process is Bun; on Node it uses **`better-sqlite3`** ([`src/sqlite-db.ts`](../src/sqlite-db.ts), [architecture.md](./architecture.md#runtime-and-database)). This file does **not** duplicate Codemap’s Node path.

We do **not** ship **`bun build --compile`** artifacts; see Bun [Single-file executable](https://bun.sh/docs/bundler/executables).

## `bun:sqlite`

**Source:** [SQLite](https://bun.com/docs/api/sqlite) — built-in **`bun:sqlite`** module, constructors, file paths, options (`readonly`, `create`, `strict`, etc.).

## Related

- [packaging.md](./packaging.md) — npm layout
