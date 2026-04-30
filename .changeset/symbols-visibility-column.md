---
"@stainless-code/codemap": minor
---

`symbols.visibility` column — JSDoc visibility tag (`@public` / `@private` / `@internal` / `@alpha` / `@beta`) extracted at parse time and stored as a real column. Replaces the `LIKE '%@beta%'` regex in the `visibility-tags` recipe. `SCHEMA_VERSION` bumps from 3 to 4 — `.codemap.db` rebuilds automatically on next index. Helper `extractVisibility(doc)` exported from `parser.ts`. New partial index `idx_symbols_visibility` covers `WHERE visibility IS NOT NULL` queries.
