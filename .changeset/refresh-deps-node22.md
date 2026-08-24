---
"@stainless-code/codemap": patch
---

Refresh runtime and toolchain dependencies. `better-sqlite3` 13 requires Node `>=22`, so published `engines.node` is now `>=22.12.0` (Node 20 dropped). `oxc-parser` 0.147 plus a heritage extractor skip for oxc's dummy recovery of invalid `interface extends`. Audit overrides pin patched `hono`, `@hono/node-server`, and `postcss`.
