# Bundled agent templates

These files ship with **`@stainless-code/codemap`** for **`codemap agents init`** — written for **npm consumers** (**`codemap`**, **`npx @stainless-code/codemap`**, etc.).

**Pointer pattern (since v1):** `templates/agents/rules/codemap.md` and `templates/agents/skills/codemap/SKILL.md` are **thin pointer files** (~16–22 lines). The full rule and skill content is served live by the installed binary via **`codemap rule`** / **`codemap skill`** (CLI) and **`codemap://rule`** / **`codemap://skill`** (MCP / HTTP). Consumers don't normally edit the pointer files — package upgrades automatically refresh the served content without re-running `agents init`.

The actual served content lives at **`templates/agent-content/{rules,skill}/*.md`** inside the package (assembled in lexical section order; `*.gen.md` sections regenerate from live data — recipe catalog, schema DDL). See [docs/agents.md](../../docs/agents.md) for the full architecture.

In **this** repository, **`.agents/`** (and **`.cursor/`** symlinks) mirror **`templates/agents/`** verbatim — both are pointers. Run `bun src/index.ts agents init --force` to regenerate them after any pointer-shape change.

**Documentation:** [docs/agents.md](../../docs/agents.md) — interactive setup, **`.gitignore`**, optional IDE wiring (Cursor, Copilot, …), pointer protocol + staleness detection.

**Customizing:** to add **your own** project-specific rules / skills, drop new files alongside the bundled pointers (e.g. **`.agents/rules/my-team-conventions.md`**, **`.agents/skills/my-domain/SKILL.md`**). The codemap rule and skill stay package-managed and auto-refresh; your files stay yours.
