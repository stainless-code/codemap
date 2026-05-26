---
"@stainless-code/codemap": patch
---

Pin runtime and dev dependencies to exact versions in `package.json` (drop carets) and refresh `bun.lock`. Dev tooling: `oxfmt` 0.52, `oxlint` 1.67, `@typescript/native-preview` 20260526. Oxlint 1.67 drops a redundant escape in `show-search-mode.ts` glob regex (no behavior change).
