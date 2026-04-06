# Bench repo

Develop Codemap in **this repository** and use a **separate clone** (for example a large internal app) only as a **real-world QA target**. The bench app does **not** need Codemap installed as a dependency.

## Configure the indexed project

**Precedence:** `--root <path>` (CLI) → **`CODEMAP_ROOT`** → **`CODEMAP_TEST_BENCH`** → `process.cwd()`.

For day-to-day work in Cursor on the Codemap repo:

1. Copy [`.env.example`](../.env.example) to **`.env`** in this repo (`.env` is gitignored).
2. Set **`CODEMAP_TEST_BENCH`** to the **absolute path** of your bench repository.

[Bun](https://bun.sh) loads `.env` from the current working directory when you run `bun src/index.ts`, so the index and `.codemap.db` target that tree without passing `--root` each time.

**Equivalent one-off:**

```bash
CODEMAP_TEST_BENCH=/absolute/path/to/your-app bun src/index.ts --full
```

Use **`CODEMAP_ROOT`** instead if you prefer the existing name; behavior is the same.

## Where the database lives

The SQLite file defaults to **`<bench-root>/.codemap.db`**, not inside the Codemap repo — so the bench tree holds its own index artifact (add to that repo’s `.gitignore` if needed).

## Agents

Work in the **stainless-code/codemap** Cursor window with [`.agents/rules/codemap.mdc`](../.agents/rules/codemap.mdc) and the [skill](../.agents/skills/codemap/SKILL.md). Queries use the DB for whatever **`CODEMAP_TEST_BENCH`** / **`--root`** resolved to.
