# External index — testing prompts (template)

Use with **`CODEMAP_ROOT`** / **`CODEMAP_TEST_BENCH`** pointed at the project under test. Copy to **`fixtures/qa/<name>.local.md`**, fill in **Ground truth** after one index, then run the same prompts **with Codemap** (query / skill) and **without** (Read/Grep only) and compare.

## How to verify

Run `codemap query` (or `bun src/index.ts query`) with the SQL in each section. Answers should match before you trust free-form chat prose.

---

## 1. Scale & coverage

**Prompts**

1. How many source files are in the Codemap index for this repo? How many React components are indexed?
2. Roughly how many `TODO` markers does the index report vs `NOTE`?

**SQL checks**

```sql
SELECT COUNT(*) AS files FROM files;
SELECT COUNT(*) AS components FROM components;
SELECT kind, COUNT(*) AS n FROM markers GROUP BY kind ORDER BY n DESC;
```

---

## 2. Definition / navigation

**Prompts**

1. In which file is the symbol `<PickARealSymbol>` defined, and what kind is it (`function`, `const`, …)?
2. What npm or workspace packages does `<ThatFile>` import directly (first 10 import sources)?

**SQL checks**

```sql
SELECT name, kind, file_path FROM symbols WHERE name = '...';
SELECT DISTINCT source FROM imports WHERE file_path = '...' ORDER BY source LIMIT 15;
```

---

## 3. Hot spots (fan-out)

**Prompts**

1. What are the top 5 files by **outgoing** dependency count (`dependencies` edges where `from_path` is that file)?
2. Why might `<top file>` be a refactor risk?

**SQL checks**

```sql
SELECT from_path, COUNT(*) AS deps
FROM dependencies GROUP BY from_path ORDER BY deps DESC LIMIT 5;
```

---

## 4. Shared modules (alias imports)

**Prompts**

1. Which `~/…` import paths are most common? Pick one and estimate how many import statements reference it.
2. Where is `~/api/client/types.gen` (or your top alias) consumed from — routers vs components?

**SQL checks**

```sql
SELECT source, COUNT(*) AS c FROM imports WHERE source LIKE '~/%'
GROUP BY source ORDER BY c DESC LIMIT 15;
```

---

## 5. Clarity vs hallucination

**Prompts**

1. Does this repo contain a **generated** route tree file? Name it and say what it likely depends on.
2. List **only** facts you can support from the index: file path + one column value from a query. No guessing.

**Cross-check**  
Open the cited file in the editor and confirm the symbol/import exists on the claimed line if the tool gave line numbers.

---

## 6. A/B protocol (manual)

| Step | With Codemap                                  | Without                               |
| ---- | --------------------------------------------- | ------------------------------------- |
| 1    | Answer prompts 1–4 using `query` / skill SQL  | Same prompts using Glob + Read + Grep |
| 2    | Paste chat export                             | Paste chat export                     |
| 3    | Score: factual errors, hedging, path accuracy | Same                                  |

Record wall-clock time and token usage if your client shows it.
