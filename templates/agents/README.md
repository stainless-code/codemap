# Bundled agent templates

These files ship with **`@stainless-code/codemap`** for **`codemap agents init`** — written for **npm consumers** ( **`codemap`**, **`npx @stainless-code/codemap`**, etc.).

In **this** repository, **`.agents/`** (and **`.cursor/`** symlinks) are **maintainer / dev** copies: examples use **`bun src/index.ts`** where that matters. **`templates/agents/`** is the **published** agent surface and is **not** required to match **`.agents/`** byte-for-byte (the **codemap** rule and skill intentionally differ).

**Documentation:** [docs/agents.md](../../docs/agents.md) — interactive setup, **`.gitignore`**, and optional IDE wiring (Cursor, Copilot, …).

After running the command in **your** project, **edit** **`.agents/`** there (paths, SQL, team conventions). Treat updates here as a reference when refreshing your copy.
