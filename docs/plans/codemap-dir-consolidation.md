# `.codemap/` directory consolidation — single root, self-managed `.gitignore`

> **Status:** in design (no code) · **Backlog:** roadmap entry to be added in this PR. Delete this file when shipped (per [`docs/README.md` Rule 3](../README.md)).

## Goal

Consolidate every codemap-managed path under a single `.codemap/` directory and ship a self-managed `.codemap/.gitignore` so future codemap features never require user `.gitignore` edits.

Today the user-facing surface has **two patterns**:

- `.codemap.db` (+ `-wal` / `-shm`) — at the project root; matched by user's `.gitignore: .codemap.*`
- `.codemap/recipes/` (tracked) + `.codemap/audit-cache/` (untracked) — under `.codemap/`; matched by `.codemap/audit-cache/` in user's `.gitignore`

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
├── .codemap/
│   ├── .gitignore              ← codemap-managed; tracked
│   ├── recipes/                ← user-authored SQL; tracked (existing)
│   │   ├── big-files.sql
│   │   └── big-files.md
│   ├── index.db                ← was .codemap.db; ignored
│   ├── index.db-wal            ← was .codemap.db-wal; ignored
│   ├── index.db-shm            ← was .codemap.db-shm; ignored
│   └── audit-cache/            ← per PR #52; ignored
│       └── <sha>/...
└── (root .gitignore — codemap entries removed by `agents init` cleanup)
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

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Blacklist over whitelist.** `.codemap/.gitignore` lists each generated artifact explicitly (per flowbite-react). Adding a new tracked source needs no change; adding a new generated artifact bumps the blacklist in the same PR that introduces it (mirrors how docs-governance Rule 9 ties new domain nouns to glossary updates).                                                                                                                                                                             |
| D2  | **DB path migration.** `.codemap.db` → `.codemap/index.db`. On boot, if `.codemap.db` exists at root AND `.codemap/index.db` doesn't, atomically `rename` it (plus `-wal` and `-shm`) into `.codemap/`, log one info line, continue. Atomic so a SIGKILL mid-migration leaves either the old shape or the new shape, never half.                                                                                                                                                                                  |
| D3  | **Migration timeline.** Shim ships in v1.x (next minor). Drop the shim in v2.0 — `.codemap.db` at root becomes a startup error pointing users at the migration changelog. Migration window is "until the next major"; no time-based deprecation.                                                                                                                                                                                                                                                                  |
| D4  | **`agents init` cleanup.** On every `codemap agents init` run: (a) write/update `.codemap/.gitignore` to the canonical content; (b) **add** `.codemap/` to root `.gitignore` ONCE as a safety net (in case nested `.gitignore` is disabled by some tool; cheap defensive guard); (c) **leave existing root entries (`.codemap.*`, `.codemap/audit-cache/`) alone** — removing them risks deleting user-authored content they happened to put on the same lines. Print a one-line "tip" suggesting manual cleanup. |
| D5  | **`.codemap/.gitignore` is regenerated on every `codemap` boot, not just `agents init`.** flowbite-react's `setupGitIgnore` runs on every CLI invocation; same shape here. Idempotent (compares content, only writes if drift). Means new generated paths land in user's checkouts the first time they run `codemap` after upgrading — no out-of-band step.                                                                                                                                                       |
| D6  | **Recipes stay where they are.** `.codemap/recipes/` is the documented location (PR #37) and stays untouched. The blacklist doesn't mention it — defaults to tracked.                                                                                                                                                                                                                                                                                                                                             |
| D7  | **Config remains opt-in via existing surfaces.** Don't conflate the dir consolidation with introducing `.codemap/config.json`. Today config lives in `package.json["codemap"]` / `.codemap.config.ts` / `--config <path>`. If we add a project-local `.codemap/config.json` later, it goes under `.codemap/` naturally without revisiting this plan.                                                                                                                                                              |
| D8  | **`audit-cache/` move?** Stays at `.codemap/audit-cache/<sha>/` — already correctly placed per PR #52. The blacklist gains a literal `audit-cache/` line. No code change for this path; only the user's `.gitignore` simplifies.                                                                                                                                                                                                                                                                                  |
| D9  | **Env var compatibility.** `CODEMAP_ROOT` continues to point at the project root (NOT `.codemap/`). The DB path is derived from project root: `<root>/.codemap/index.db`. No new env var needed. `CODEMAP_DATABASE_PATH` (if a user has it set explicitly) is still honored verbatim — escape hatch for non-standard layouts.                                                                                                                                                                                     |
| D10 | **Self-managed `.gitignore` is itself tracked.** `.codemap/.gitignore` is committed to the user's repo; codemap rewrites it idempotently. Same pattern flowbite-react uses (`.flowbite-react/.gitignore` is in their git history). User can edit it manually but codemap will overwrite back to the canonical shape on next boot — pattern consistent with `package.json` write-on-install behaviors.                                                                                                             |

## Tracers

| #   | Slice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Acceptance                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | **DB path constant + migration shim** in `src/runtime.ts` / `src/db.ts`. Default `databasePath` = `<projectRoot>/.codemap/index.db`. On `openDb()`, run `migrateLegacyDatabaseLocation(projectRoot)` once per process (idempotent guard) — atomically `rename` `.codemap.db` + `-wal` + `-shm` into `.codemap/` if the old shape is detected and the new shape doesn't already exist. Log one info line on migration. Unit tests for: fresh project (creates `.codemap/index.db`), legacy project (migrates), already-migrated (no-op), conflicting both-paths (error). | All four scenarios covered; no DB content lost on migration.                     |
| 2   | **`.codemap/.gitignore` writer** in `src/application/codemap-gitignore.ts` (new) — `setupCodemapGitignore({projectRoot})` writes the canonical blacklist if drift. Mirrors flowbite-react's `setupGitIgnore` shape. Called from `runCodemapIndex` startup AND `agents init`. Idempotent. Unit tests for: fresh write, idempotent re-run, user-modified content (overwrites back).                                                                                                                                                                                       | Writer fires once per boot; content matches the canonical shape.                 |
| 3   | **`agents-init.ts` updates** — `ensureGitignoreCodemapPattern` simplifies to a single `.codemap/` line (defensive root entry per D4) instead of the per-feature list; calls `setupCodemapGitignore` for the nested file. Existing `.codemap.*` / `.codemap/audit-cache/` entries in root `.gitignore` left alone. Tests updated.                                                                                                                                                                                                                                        | `agents init` writes both files; existing tests pass with adjusted expectations. |
| 4   | **Doc + agent rule sync** — README (one paragraph on the new layout + migration), `docs/architecture.md` § Persistence wiring (DB path, gitignore strategy), `docs/glossary.md` (`.codemap/` entry expanded), `.agents/` + `templates/agents/` rule + skill (Rule 10 lockstep — agents may need to know the new path when constructing `--db` flags). Repo's own root `.gitignore` slimmed to drop `.codemap.*` + `.codemap/audit-cache/` (replaced by `.codemap/.gitignore`).                                                                                          | All docs consistent; this repo dogfoods the new layout.                          |
| 5   | **Changeset (minor) + plan deletion** — minor with explicit migration messaging ("first run after upgrade silently moves `.codemap.db` to `.codemap/index.db`; legacy path becomes an error in v2"). v2 cleanup tracked in roadmap.                                                                                                                                                                                                                                                                                                                                     | Changeset shipped; plan deleted per Rule 3.                                      |

## Performance considerations

- **Migration cost** — single `rename(2)` per file (DB + WAL + SHM); microseconds. No data copy.
- **`.codemap/.gitignore` write** — read-compare-write per boot; sub-ms when content matches (the common case).
- **Nested `.gitignore` lookup cost** — git already walks for nested ignores everywhere; one extra file is irrelevant.
- **Disk layout change** — `.codemap.db` and `.codemap/.codemap.db` (during migration window) could exist briefly if a user has both — defensive: if both exist, error and ask the user to pick.

## Alternatives considered

| Candidate                                                                                                            | Why not                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Whitelist `.codemap/.gitignore` (`\* + !recipes/**`)\*\*                                                           | Safer for newcomers (default ignored, opt-in) but harder to read — the user can't tell which files are generated by glancing at the `.gitignore`. flowbite-react picked blacklist for the same reason.                 |
| **Keep `.codemap.db` at root, only consolidate caches under `.codemap/state/`**                                      | Avoids the migration but keeps the dual-pattern surface forever — every cache PR still patches the user's root `.gitignore` (just once instead of twice). The whole point of this refactor is collapsing that surface. |
| **Self-managed root-level `.gitignore` block (between `# codemap-managed start` / `# codemap-managed end` markers)** | More fragile than a separate file; easy for users to break the markers; doesn't survive merge conflicts well. The flowbite-react pattern (separate file under the tool's own dir) sidesteps all of this.               |
| **No migration — break existing users on upgrade**                                                                   | Hostile UX. Migration shim is ~30 lines and lives 1 minor cycle.                                                                                                                                                       |
| **Move recipes too (`.codemap/state/recipes/`)**                                                                     | Recipes are user-authored source code; nesting them inside `state/` blurs "I wrote this" vs "the tool generated this". Kept at `.codemap/recipes/` (top-level under `.codemap/`) for clarity.                          |

## Out of scope

- **`.codemap/config.json`** — separate decision (D7). Adding it later requires no plan revisit; it'll just be a tracked file inside `.codemap/`.
- **Telemetry / analytics state** — speculative; if added, lands under `.codemap/<feature>/` and gets a blacklist line.
- **Cross-process locking on the DB path during migration** — single SQLite WAL handles concurrent readers; the migration window is `rename`-atomic so the worst case is a spurious "DB not found" on a concurrent process that's already past the existence check. Acceptable for a one-shot migration step.
- **Backward-compat `--db .codemap.db`** — if the user explicitly passes the legacy path via env or CLI, honor it (D9). No deprecation warning yet.
- **Auto-cleanup of root `.gitignore` codemap entries** (per D4 — leave them alone). Adding a dedicated `codemap agents cleanup-gitignore` verb is a v2 concern.
