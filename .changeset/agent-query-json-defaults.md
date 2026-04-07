---
"@stainless-code/codemap": patch
---

Shipped agent rules and skills now lead with **`codemap query --json`** (optional table output when **`--json`** is omitted). Add **`bun run benchmark:query`** to compare **`console.table`** vs JSON stdout size, plus integration tests for **`--json`** vs default output when **`.codemap.db`** is present. README and **`docs/`** (including **`benchmark.md`** § Query stdout) updated to match.
