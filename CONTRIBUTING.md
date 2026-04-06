# Contributing

Codemap is in **bootstrap / extraction** phase. Before large PRs, please open an issue so we can align on:

- **Core vs adapter** — core should stay small; language-specific logic belongs in **adapters** (see [docs/ROADMAP.md](docs/ROADMAP.md)).
- **Bun-first** — v1 targets Bun APIs (`bun:sqlite`, `Worker`); Node compatibility is a later concern.

When the codebase lands here, we will add:

- `CONTRIBUTING.md` — dev setup, `bun test`, PR checklist
- Issue templates for **adapter proposals** vs **core bugs**

Thank you for helping make structural codebase queries fast and reusable for agents.
