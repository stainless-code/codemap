---
"@stainless-code/codemap": minor
---

feat(mcp/serve): default-ON watcher for `codemap mcp` and `codemap serve`

Stale-index friction is empirically the most-frequent agent UX issue under `codemap mcp` (driving the watch-mode planning in PR #46) and the most-frequent CI/IDE-plugin friction under `codemap serve`. Both modes are inherently long-running, so the chokidar co-process pays for itself immediately. Decision originally resolved 2026-05 (research note `§ 6 Q1`); this PR ships it.

**New defaults.**

- `codemap mcp` — watcher boots automatically; tools always read a live index.
- `codemap serve` — same.
- One-shot CLI defaults preserved: `codemap query` / `codemap show` / `codemap snippet` / etc. still spawn no watcher.

**Opt out.**

- `--no-watch` flag (new) — explicit opt-out for ephemeral-index workflows, fire-and-forget CI scripts, etc.
- `CODEMAP_WATCH=0` / `CODEMAP_WATCH="false"` — env-shortcut mirroring `--no-watch` for IDE / CI launches that can't easily edit the spawn command.

**Backwards-compat preserved.**

- `--watch` flag still parses and is honored (no-op since it matches the new default; kept so existing scripts and launch commands don't break).
- `CODEMAP_WATCH=1` / `CODEMAP_WATCH="true"` still parses (redundant after the flip, kept for backwards-compat).
- `--no-watch` wins over `--watch` when both passed (last-write semantics).

**Tradeoffs accepted.**

- Slightly slower mcp/serve startup (~chokidar boot cost, validated tiny on Bun + Node by PR #46's 6-watcher audit).
- Spawns a second process — visible to users running `htop` / `Activity Monitor`. Worth it for the live-index correctness gain.

**Tests:** 12 new tests across `cmd-mcp.test.ts` and `cmd-serve.test.ts` cover default-ON behavior, `--no-watch` opt-out, env opt-out (`CODEMAP_WATCH=0` / `"false"`), env opt-in still honored (`CODEMAP_WATCH=1`), and `--no-watch` wins over `--watch`.

**Lockstep updates:** `templates/agents/rules/codemap.md`, `templates/agents/skills/codemap/SKILL.md`, `.agents/rules/codemap.md`, `.agents/skills/codemap/SKILL.md`, and `README.md` all updated to reflect the new defaults + opt-out shape per `docs/README.md` Rule 10.
