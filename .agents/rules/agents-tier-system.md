---
description: Tier system for .agents/ rules and skills — context-targeted attachment via the right Cursor frontmatter mode. Apply when authoring a new rule or skill, or when reviewing an existing one's attachment cost.
globs:
  - ".agents/rules/**"
  - ".agents/skills/**"
  - ".cursor/rules/**"
  - ".cursor/skills/**"
alwaysApply: false
---

# `.agents/` tier system

Cursor rules support three attachment modes. Each new rule must consciously pick one.

| Mode              | Frontmatter                                           | Cost per turn                               | Use for                                                                       |
| ----------------- | ----------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| **Always-on**     | `alwaysApply: true`                                   | full rule body always loaded                | cross-cutting **practices** — define how we work, not what we build           |
| **Auto-attached** | `alwaysApply: false` + `globs:`                       | zero unless a matching file is in scope     | technical **patterns** — what we write under `.agents/**`, `src/cli/**`, etc. |
| **Discoverable**  | `alwaysApply: false` + `description:` only (no globs) | zero unless description matches user intent | intent-driven **workflows** — the user said "do X"                            |

## Tiers in this repo

### Tier 1 — Always-on practices (~10 rules max)

Genuinely cross-cutting. Apply to every turn regardless of file:

- `agents-first-convention` — `.agents/` source-of-truth + `.cursor/` symlinks discipline
- `codemap` — STOP-before-grep
- `concise-comments` — sweep your own new comments before reporting
- `concise-reporting` — extreme concision in agent reports
- `lessons` — read at session start, append after corrections
- `no-bypass-hooks` — never `--no-verify` on `git commit`
- `pr-comment-fact-check` — fires the fact-check skill on PR-comment intent triggers
- `preserve-comments` — never silently delete TODOs / commented-out code
- `tracer-bullets` — small end-to-end slices, not horizontal layers
- `verify-after-each-step` — run the project's checks per milestone, not at commit time

### Tier 2 — Auto-attached technical rules (this rule's tier)

Glob-attached. Each is a thin priming layer (~30–50 lines: top-N principles + `Reference` section pointing at the deep-dive skill).

Skills get a paired Tier-2 rule when they have **always-on principles** that should fire whenever the relevant files are in scope (e.g. when codemap grows a TS-specific style rule, it would attach to `**/*.{ts,tsx}`).

Today's Tier-2 rules:

- `agents-tier-system` (this rule) — auto-attaches when authoring under `.agents/**` or `.cursor/**`.
- `docs-governance` — primes the docs framework when authoring under `docs/**` or `.agents/**` (paired with [`docs-governance` skill](../skills/docs-governance/SKILL.md)).

### Tier 3 — Discoverable skills (no rule)

Pure intent-triggered. The skill description is detailed enough that Cursor surfaces it on relevant phrases. No always-on cost.

Skills stay rule-less when the work is **explicitly invoked** by the user, not pattern-triggered. Today: `audit-pr-architecture`, `diagnose`, `docs-governance`, `docs-lifecycle-sweep`, `grill-me`, `improve-codebase-architecture`, `write-a-skill`. (Skills like `gritql-codemods` and `ubiquitous-language` would also fit this tier if adopted.)

## Authoring guidelines

### Adding a new rule

1. **Decide the tier** before writing.
2. **Tier 1 needs justification** — does it really apply to every turn? If it only applies in certain files / certain intents, demote to Tier 2 or Tier 3.
3. **Tier 2 globs** — write the broadest pattern that's still meaningfully scoped. `**/*.ts` is acceptable for TS-wide rules. Filename heuristics (`*recipe*.ts`) are brittle for content-driven concerns and should be a last resort.
4. **Tier 3 description** — write the description as if Cursor is grepping for trigger phrases. Include the verbs and nouns the user is likely to say ("rename", "delete", "convert", "consolidate") and the symbols / patterns the agent will see in code.
5. **Pair with a skill** — every Tier-1 / Tier-2 rule should link to a skill in its `Reference` section for the deep dive. The rule is priming; the skill is reference.
6. **Author the source under `.agents/rules/<name>.md` and symlink from `.cursor/rules/<name>.mdc`** per the [`agents-first-convention`](./agents-first-convention.md) rule.

### Adding a new skill

1. **Decide if it needs a rule.** If the skill has always-on principles (any `NEVER` / `ALWAYS` clauses, any "MUST be used when") — pair it with a Tier-1 or Tier-2 rule.
2. **If skill-only**, write the description with explicit trigger phrases. Cursor's discovery is description-match-based.
3. **Author under `.agents/skills/<name>/SKILL.md` and symlink from `.cursor/skills/<name>`** per the [`agents-first-convention`](./agents-first-convention.md) rule.

## Authoring discipline: durability

Rules and skills are **more durable** than the artifacts they describe. They outlive specific files, specific commit hashes, specific code shapes. Authoring them as if they were short-lived is the most common way they go stale.

Three concrete sub-rules:

1. **Don't cite specific audit / plan / research filenames as canonical examples.** Audits and plans are mortal under [`docs-lifecycle-sweep`](../skills/docs-lifecycle-sweep/SKILL.md) (Tier C delete or Tier B slim). The first time the doc janitor retires a file your skill named, the skill's example rots. Use shape placeholders (`<YYYY-MM-DD>-<topic>.md`, `<topic>.md`) and describe the **shape** of what the next reader should look for ("the most recent audit under `docs/audits/`"), not which file does it today. **Reference docs (`README.md`, `architecture.md`, `glossary.md`, `roadmap.md`, `agents.md`) ARE durable** — citing them by name is fine; they live forever per their lifecycle type.
2. **Don't cite specific commit hashes or PR numbers as the only path to context.** Hashes and PR URLs are stable but opaque. If the context matters, summarise it inline. Hashes are good as **secondary** anchors ("the seed datapoint, commit `<hash>`") not primary ones.
3. **Don't cite specific source-code line numbers.** Same drift as above; lines move on every edit. Reference symbols by name. (Same hazard as [`docs/README.md` Rule 7](../../docs/README.md) — universal, not codemap-specific.)

When in doubt: if the prose still reads correctly six months from now after every doc you didn't write got rewritten or deleted, the skill is durable. If it reads as a stale snapshot, slim the citations to placeholders.

## Audit prompts

When reviewing an existing rule:

- **Is it Tier 1?** Check: does it apply on every turn? If it only applies to TS files, flip to Tier 2 with a glob.
- **Is it Tier 2?** Check: are the globs well-scoped? Could broader globs catch content-driven cases? Could narrower globs save context without losing coverage?
- **Is it skill-only?** Check: does the skill have any "always" / "never" clauses? If yes, it deserves a rule.

## Reference

- File-layout convention: [`agents-first-convention.md`](./agents-first-convention.md).
- The docs-governance pair this tier system was first applied to in this repo: [`docs-governance.md` rule](./docs-governance.md) (Tier-2 priming) + [`docs-governance` skill](../skills/docs-governance/SKILL.md) (deep reference).
