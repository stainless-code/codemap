import { isAbsolute, resolve } from "node:path";

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
