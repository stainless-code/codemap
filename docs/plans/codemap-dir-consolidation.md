# `.codemap/` directory consolidation — single root, self-managed `.gitignore`

> **Status:** in design (no code) · **Backlog:** roadmap entry to be added in this PR. Delete this file when shipped (per [`docs/README.md` Rule 3](../README.md)).

## Goal

Consolidate every codemap-managed path under a single state directory (`<state-dir>`, configurable, default `.codemap/`) and ship a self-managed `<state-dir>/.gitignore` so future codemap features never require user `.gitignore` edits.

Today the user-facing surface has **three patterns**:

- `<root>/.codemap.db` (+ `-wal` / `-shm`) — root-level SQLite files; matched by user's `.gitignore: .codemap.*`.
- `<root>/codemap.config.{ts,json}` — root-level config file; tracked.
- `<root>/.codemap/recipes/` (tracked) + `<root>/.codemap/audit-cache/` (untracked) — under `.codemap/`; matched by `.codemap/audit-cache/` in user's `.gitignore`.

Every new cache or persistent state we add (audit-cache shipped in PR #52, future ones for impact-graph caching, query-result caching, telemetry, etc.) requires another line in the user's `.gitignore` via `agents-init.ts`. The `flowbite-react` precedent (`.flowbite-react/.gitignore` shipping a blacklist of generated artifacts) collapses that surface to one self-managed file.

## Why

- **Future-proof.** New codemap state lives under `.codemap/`; bumping the blacklist in `.codemap/.gitignore` is automatic on `codemap` boot, not a user-visible change.
- **Single-dir convention.** Matches `.git/`, `.next/`, `.turbo/`, `.vercel/`, `.flowbite-react/` — every modern tool that owns project state ships one root.
- **Cleaner root.** Project listings (file explorers, IDE sidebars, `ls`) show one `.codemap/` entry instead of `.codemap.db` + `.codemap.db-wal` + `.codemap.db-shm` + `.codemap/`.
- **Self-managed `.gitignore`.** Reader of `.codemap/.gitignore` immediately sees what's machine-written; adding a new tracked source (e.g. future `config.json`) doesn't need a `.gitignore` change.
- **Closes the per-feature `agents-init.ts` `.gitignore` patching surface.** PR #52 added `.codemap/audit-cache/`; PR #X would add `.codemap/<next>/`. Done.

## Sketched layout

```text
<projectRoot>/
├── .codemap/                   ← default; overridable via --state-dir / CODEMAP_STATE_DIR
│   ├── .gitignore              ← codemap-managed; tracked
│   ├── config.ts               ← was <root>/codemap.config.ts; tracked (D12)
│   ├── recipes/                ← user-authored SQL; tracked (existing)
│   │   ├── big-files.sql
│   │   └── big-files.md
│   ├── index.db                ← was .codemap.db; ignored
│   ├── index.db-wal            ← was .codemap.db-wal; ignored
│   ├── index.db-shm            ← was .codemap.db-shm; ignored
│   └── audit-cache/            ← per PR #52; ignored
│       └── <sha>/...
└── (root .gitignore — codemap entries no longer needed)
```

`.codemap/.gitignore` (blacklist, mirrors flowbite-react's `class-list.json` / `pid` shape):

```gitignore
index.db
index.db-wal
index.db-shm
audit-cache/
```

User's root `.gitignore` no longer needs **any** codemap entries — git respects the nested `.gitignore`. `agents init` stops touching the root `.gitignore` for codemap and instead writes `.codemap/.gitignore` on first init.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | **Blacklist over whitelist.** `<state-dir>/.gitignore` lists each generated artifact explicitly (per flowbite-react). Adding a new tracked source needs no change; adding a new generated artifact bumps the blacklist in the same PR that introduces it (mirrors how docs-governance Rule 9 ties new domain nouns to glossary updates).                                                                                                                                                                                             |
| D2  | **No migration shim.** Codemap is pre-v1; this PR moves `.codemap.db` → `<state-dir>/index.db` cleanly with no compat code. Existing dev clones run `rm .codemap.db` once and re-index. Same for `<root>/codemap.config.{ts,json}` → `<state-dir>/config.{ts,json}`. Changelog notes the one-line cleanup.                                                                                                                                                                                                                           |
| D3  | **`agents init` writes both the nested `.gitignore` and a root entry.** On every `codemap agents init` run: (a) write/update `<state-dir>/.gitignore` to the canonical content; (b) ensure root `.gitignore` contains `<state-dir>/` ONCE as a safety net (covers tools that disable nested `.gitignore` lookup). Both writes are idempotent. Pre-existing entries like `.codemap.*` are left alone — pre-v1, users can clean up manually if they care.                                                                              |
| D4  | **`<state-dir>/.gitignore` is regenerated on every `codemap` boot, not just `agents init`.** flowbite-react's `setupGitIgnore` runs on every CLI invocation; same shape here. Idempotent (read-compare-write; only fires on drift). New generated paths land in user's checkouts the first time they run `codemap` after upgrading — no out-of-band `agents init` re-run needed.                                                                                                                                                     |
| D5  | **Recipes stay where they are.** `<state-dir>/recipes/` is the documented location (PR #37) and stays. The blacklist doesn't mention it — defaults to tracked.                                                                                                                                                                                                                                                                                                                                                                       |
| D6  | **`audit-cache/` move?** Stays at `<state-dir>/audit-cache/<sha>/` — already correctly placed per PR #52. The blacklist gains a literal `audit-cache/` line.                                                                                                                                                                                                                                                                                                                                                                         |
| D7  | **State directory is configurable; default `.codemap/`.** Resolved at bootstrap (NOT via the config file — chicken-and-egg) in this order: (1) `--state-dir <path>` CLI arg, (2) `CODEMAP_STATE_DIR` env var, (3) default `<projectRoot>/.codemap/`. Resolves relative paths against `projectRoot`. The dir name flows through every codemap-managed path uniformly — DB at `<state-dir>/index.db`, gitignore at `<state-dir>/.gitignore`, config at `<state-dir>/config.{ts,json}`, audit cache at `<state-dir>/audit-cache/`, etc. |
| D8  | **Config file moves into `<state-dir>/config.{ts,js,json}`.** Replaces `<root>/codemap.config.{ts,json}`. Bootstrap order: (1) `--config <path>` (CLI override; absolute / relative-to-cwd path, no implicit `<state-dir>/` prefix), (2) `<state-dir>/config.ts`, (3) `<state-dir>/config.js`, (4) `<state-dir>/config.json`. Pre-v1 → no back-compat for the legacy root paths; doc the one-line move in the changelog. The config file is **tracked** (it's user-authored source, not generated) — no entry in the blacklist.      |
| D9  | **Env vars.** `CODEMAP_ROOT` continues to point at the project root (unchanged). `CODEMAP_STATE_DIR` (new) overrides the default `<projectRoot>/.codemap/` location. No `CODEMAP_DATABASE_PATH` — `--state-dir` IS the escape hatch for non-standard layouts; if one of the few existing users had `CODEMAP_DATABASE_PATH` set, the changelog notes the rename.                                                                                                                                                                      |
| D10 | **Self-managed `.gitignore` is itself tracked.** `<state-dir>/.gitignore` is committed to the user's repo; codemap rewrites it idempotently. Same pattern flowbite-react uses. User can edit it manually but codemap will overwrite back to canonical on next boot — consistent with `package.json` write-on-install behaviors.                                                                                                                                                                                                      |

## Tracers

| #   | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Acceptance                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | **State-dir resolver + DB path** in `src/runtime.ts` (or new `src/state-dir.ts`). `resolveStateDir({root, cliFlag, env})` returns the absolute `<state-dir>` per D7 ordering. `getDatabasePath()` becomes `<state-dir>/index.db`. Bootstrap order check + relative-path resolution. Unit tests for: default, `--state-dir` flag, env var, env+flag (flag wins), relative path resolution.                                                                                                                                                                                                                                                                                                                                                   | Resolver covers all four sources with deterministic precedence.                    |
| 2   | **Config loader move** — `loadUserConfig({root, stateDir, explicitPath?})` looks at `<state-dir>/config.{ts,js,json}` (D8 order); legacy `<root>/codemap.config.{ts,json}` paths dropped (pre-v1 — no fallback). `--config <path>` CLI flag continues to take an explicit path. Tests updated for the new search locations.                                                                                                                                                                                                                                                                                                                                                                                                                 | Config loaded from `<state-dir>/config.*`; legacy paths return undefined silently. |
| 3   | **`<state-dir>/.gitignore` writer** in `src/application/state-gitignore.ts` (new) — `setupStateGitignore({stateDir})` writes the canonical blacklist if drift. Mirrors flowbite-react's `setupGitIgnore` shape. Called from `runCodemapIndex` startup AND `agents init`. Idempotent. Unit tests for: fresh write, idempotent re-run, user-modified content (overwrites back).                                                                                                                                                                                                                                                                                                                                                               | Writer fires once per boot; content matches canonical shape.                       |
| 4   | **`agents-init.ts` updates** — `ensureGitignoreCodemapPattern` rewrites to add `<state-dir-name>/` to root `.gitignore` ONCE (per D3) and call `setupStateGitignore`. Existing legacy entries left alone. Tests updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `agents init` writes both files; tests pass.                                       |
| 5   | **Doc + changeset + plan deletion** — README (one paragraph on the new layout, `--state-dir` flag, config-file move), `docs/architecture.md` § Persistence wiring (state-dir resolver, gitignore strategy, config-file path), `docs/glossary.md` (`<state-dir>` + `CODEMAP_STATE_DIR` entries), `.agents/` + `templates/agents/` rule + skill (Rule 10 lockstep — agents may need to know the new path when constructing CLI invocations). Repo's own root `.gitignore` slimmed to drop `.codemap.*` + `.codemap/audit-cache/`; `.codemap/.gitignore` checked in. Repo's own `codemap.config.*` (if any) moved into `.codemap/config.*`. Minor changeset with the one-line cleanup instructions for existing devs. Plan deleted per Rule 3. | All docs consistent; repo dogfoods the new layout.                                 |

## Performance considerations

- **State-dir resolution** — three `process.env`/argv reads + one `path.resolve`; sub-µs.
- **`<state-dir>/.gitignore` write** — read-compare-write per boot; sub-ms when content matches (the common case).
- **Nested `.gitignore` lookup cost** — git already walks for nested ignores everywhere; one extra file is irrelevant.
- **Config file lookup** — three `existsSync` calls (ts → js → json) per boot; sub-ms.

## Alternatives considered

| Candidate                                                                                                            | Why not                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Whitelist `<state-dir>/.gitignore` (`\* + !recipes/**`)\*\*                                                        | Safer for newcomers (default ignored, opt-in) but harder to read — the user can't tell which files are generated by glancing at the `.gitignore`. flowbite-react picked blacklist for the same reason.            |
| **Keep `.codemap.db` at root, only consolidate caches under `<state-dir>/`**                                         | Avoids the move but keeps the dual-pattern surface forever — every cache PR still patches the user's root `.gitignore` (just once instead of twice). The whole point of this refactor is collapsing that surface. |
| **Self-managed root-level `.gitignore` block (between `# codemap-managed start` / `# codemap-managed end` markers)** | More fragile than a separate file; easy for users to break the markers; doesn't survive merge conflicts well. The flowbite-react pattern (separate file under the tool's own dir) sidesteps all of this.          |
| **Migration shim with deprecation timeline**                                                                         | Pre-v1 — see D2. Two existing dev clones (codemap repo itself + `CODEMAP_TEST_BENCH` projects) can each `rm .codemap.db` once.                                                                                    |
| **State-dir name configurable via the config file (not just CLI/env)**                                               | Chicken-and-egg: codemap needs to know `<state-dir>` to find the config that says where `<state-dir>` is. Bootstrap via CLI/env only (D7); config file controls everything else.                                  |
| **Move recipes too (`<state-dir>/state/recipes/`)**                                                                  | Recipes are user-authored source; nesting them under `state/` blurs "I wrote this" vs "the tool generated this". Kept at `<state-dir>/recipes/` (top-level under `<state-dir>/`) for clarity.                     |

## Out of scope

- **Telemetry / analytics state** — speculative; if added, lands under `<state-dir>/<feature>/` and gets a blacklist line.
- **Backward-compat for `<root>/codemap.config.{ts,json}`** — pre-v1, dropped cleanly per D2/D8. Changelog notes the move.
- **Backward-compat for `<root>/.codemap.db`** — pre-v1, dropped cleanly per D2. `rm .codemap.db && codemap` re-indexes from scratch.
- **Auto-cleanup of root `.gitignore` codemap entries** — per D3, leave existing lines alone. A dedicated `codemap agents cleanup-gitignore` verb is a v1.x+ concern.
- **`CODEMAP_TEST_BENCH` env semantics** — continues pointing at a project root; the resolved `<state-dir>` is derived per D7.
