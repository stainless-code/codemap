# Good and bad tests (this repo)

Loaded from [`tdd`](./SKILL.md). Multiple runners — pick by whether the behavior is unit logic, golden SQL output, or script harness (see [`docs/testing-coverage.md`](../../../docs/testing-coverage.md)).

## Good tests

Integration-style through the **public seams** (parser entry, DB insert path, CLI handler, recipe SQL output):

```ts
import { describe, expect, it } from "bun:test";
import Database from "better-sqlite3";
import { insertFile, openDb } from "../db";

describe("insertFile", () => {
  it("persists path and language for a new file row", () => {
    const db = openDb(new Database(":memory:"));
    insertFile(db, { path: "src/foo.ts", language: "typescript" });
    const row = db
      .prepare("SELECT path, language FROM files WHERE path = ?")
      .get("src/foo.ts");
    expect(row).toEqual({ path: "src/foo.ts", language: "typescript" });
  });
});
```

Characteristics:

- Observable behavior callers care about (index rows, recipe output, CLI exit code, parse symbols)
- Public seam only — `extractFileData`, `batchInsert`, a `cmd-*` handler, golden scenario SQL
- Survives internal refactors of parsers/engines
- One logical assertion per test

## Bad tests

```ts
// BAD: mocks an internal helper of the parser
vi.mock("./internal-visitor", () => ({ walkSymbols: () => [] }));

// BAD: asserts call order on a private batch scheduler
expect(internalBatchQueue.flush).toHaveBeenCalledBefore(insertSymbols);

// BAD: reaches past the seam — reads the DB helper's internal cache
expect(db.__cache.get("files")).toEqual(rows);

// BAD: golden test that snapshots the entire index.db binary
expect(fs.readFileSync("index.db")).toMatchSnapshot();
```

Red flags: mocking own modules under `src/`, testing private helpers, call-count assertions, tests that break on a rename-only refactor, golden snapshots that aren't stable JSON contracts.

## Mock boundaries

Mock at the **parser or DB seam** only:

- **OK to fake** — `:memory:` SQLite via `better-sqlite3`; a minimal fixture file string passed to `extractFileData`; resolver results stubbed at the adapter boundary.
- **Don't mock** — internals of `src/parser.ts` under test, real `batchInsert` when testing insert logic (use `:memory:` DB instead), golden runner internals when testing recipe SQL (exercise the real scenario file).

```ts
// GOOD: fake the DB, exercise the real insert path
const db = openDb(new Database(":memory:"));
insertSymbols(db, symbolsFromFixture);
```

Designing for mockability: engines already accept `Database` and parsed AST inputs as arguments — no module-scope globals to wrestle with. Prefer `:memory:` DB over mocking `better-sqlite3` unless the bug only reproduces against on-disk WAL behavior.

## Golden / recipe tests

Test recipe **output shape**, not implementation:

```ts
// GOOD: behavior through declared golden scenario
// scenarios.json expects row count + key columns for find-symbol-definitions

// BAD: asserts on internal SQL string assembly in recipes-loader
expect(loader.__compiled.get("fan-in")).toContain("WITH RECURSIVE");
```

Refresh goldens after intentional schema or fixture changes: `bun scripts/query-golden.ts --update`.

## Script harness tests (`scripts/**/*.test.mjs`)

Test what a maintainer script exposes (CLI args, file transforms), not Node internals:

```js
// GOOD: behavior through public script output
expect(await runScript(["--dry-run"])).toMatchObject({ ok: true });

// BAD: asserts on internal subprocess spawn count
expect(spawnMock).toHaveBeenCalledTimes(3);
```
