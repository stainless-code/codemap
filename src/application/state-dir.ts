import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Default name of the codemap state directory under `<projectRoot>`.
 * Holds every codemap-managed file: `index.db` (+ WAL/SHM), `audit-cache/`,
 * `recipes/`, `config.{ts,js,json}`, `.gitignore` (self-managed).
 */
export const STATE_DIR_DEFAULT = ".codemap";

/** Filename of the SQLite index inside `<state-dir>/`. */
export const STATE_DB_NAME = "index.db";

/** Filename of the codemap-managed `.gitignore` inside `<state-dir>/`. */
export const STATE_GITIGNORE_NAME = ".gitignore";

/** Config-file basename probed (in this order) inside `<state-dir>/`. */
export const STATE_CONFIG_BASENAMES = [
  "config.ts",
  "config.js",
  "config.json",
] as const;

export interface ResolveStateDirOpts {
  root: string;
  /** From `--state-dir <path>` CLI flag. */
  cliFlag?: string | undefined;
  /** From `CODEMAP_STATE_DIR` env var. */
  env?: string | undefined;
}

/**
 * Resolve the absolute `<state-dir>` per plan §D7. Precedence:
 * (1) `--state-dir <path>`, (2) `CODEMAP_STATE_DIR`, (3) `<root>/.codemap`.
 * Relative paths resolve against `root`. Returns absolute.
 */
export function resolveStateDir(opts: ResolveStateDirOpts): string {
  const raw = opts.cliFlag ?? opts.env ?? STATE_DIR_DEFAULT;
  return isAbsolute(raw) ? raw : resolve(opts.root, raw);
}

/**
 * Canonical contents of `<state-dir>/.gitignore` — codemap-managed
 * blacklist. Bumping this constant IS the migration: every consumer's
 * project repairs itself on the next `codemap` run via {@link ensureStateGitignore}.
 *
 * Kept as one string (not an array of patterns) so the ENTIRE file is
 * the source of truth — header, blank lines, and ordering all reproduce
 * verbatim. Add new generated artifacts in the same PR that introduces them.
 */
export const STATE_GITIGNORE_BODY = `# codemap-managed — edits will be overwritten by \`ensureStateGitignore\`.
# Blacklist of generated artifacts; tracked sources (recipes/, config.*)
# default to tracked. Bump alongside any new cache (Rule 9 analogue).
index.db
index.db-shm
index.db-wal
audit-cache/
`;

export interface EnsureStateGitignoreResult {
  /** Content present before the call (`undefined` when the file didn't exist). */
  before: string | undefined;
  /** Content written (or that would have been written if it had drifted). */
  after: string;
  /** True when the file was created or rewritten; false on the steady-state hit. */
  written: boolean;
}

/**
 * Self-healing reconciler for `<state-dir>/.gitignore` (D11). Idempotent:
 * read → compare to {@link STATE_GITIGNORE_BODY} → write only on drift.
 * Auto-creates `<state-dir>/` if absent. Pure shape (`{before, after,
 * written}`) so callers can unit-test the decision separately from the
 * filesystem effect.
 */
export function ensureStateGitignore(
  stateDir: string,
): EnsureStateGitignoreResult {
  const path = join(stateDir, STATE_GITIGNORE_NAME);
  const before = existsSync(path) ? readFileSync(path, "utf-8") : undefined;
  if (before === STATE_GITIGNORE_BODY) {
    return { before, after: STATE_GITIGNORE_BODY, written: false };
  }
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(path, STATE_GITIGNORE_BODY, "utf-8");
  return { before, after: STATE_GITIGNORE_BODY, written: true };
}
