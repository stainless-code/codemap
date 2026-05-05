import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  resolveStateDir,
  STATE_CONFIG_BASENAMES,
  STATE_DB_NAME,
} from "./application/state-dir";

async function readJsonFile(filePath: string): Promise<unknown> {
  if (typeof Bun !== "undefined") {
    return Bun.file(filePath).json();
  }
  const text = await readFile(filePath, "utf-8");
  return JSON.parse(text) as unknown;
}

/**
 * Default glob patterns for indexing (relative to project root).
 * Override with `include` in `codemap.config`.
 */
export const DEFAULT_INCLUDE_PATTERNS = [
  "**/*.{ts,tsx,js,jsx,cjs,mjs,mts,cts}",
  "**/*.css",
  "**/*.{md,mdx,mdc}",
  "**/*.{json,yml,yaml}",
  "**/*.sh",
] as const;

/**
 * Directory **names** excluded when they appear as any path segment (not full paths).
 * Override with `excludeDirNames` in `codemap.config`.
 */
export const DEFAULT_EXCLUDE_DIR_NAMES = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".output",
  "coverage",
  "storybook-static",
  ".turbo",
  ".cache",
  ".parcel-cache",
  "vendor",
] as const;

/**
 * Zod schema for user config (`<state-dir>/config.{ts,js,json}`, `defineConfig`, API).
 * Unknown keys are rejected (`.strict()`).
 */
export const codemapUserConfigSchema = z
  .object({
    root: z
      .string()
      .optional()
      .describe("Project root. Defaults via CLI `--root` or `process.cwd()`."),
    databasePath: z
      .string()
      .optional()
      .describe(
        "SQLite database path, relative to root or absolute. Default: `<state-dir>/index.db` (i.e. `.codemap/index.db`).",
      ),
    include: z
      .array(z.string())
      .optional()
      .describe(
        "Glob patterns relative to root; replaces default include list when set.",
      ),
    excludeDirNames: z
      .array(z.string())
      .optional()
      .describe(
        "Directory name segments to skip; replaces default exclude list when set.",
      ),
    tsconfigPath: z
      .union([z.string(), z.null()])
      .optional()
      .describe(
        "Path to `tsconfig.json` for import alias resolution. Use `null` to disable.",
      ),
    fts5: z
      .boolean()
      .optional()
      .describe(
        "Enable FTS5 full-text indexing of file content into the `source_fts` virtual table. Default `false` — FTS5 grows `.codemap/index.db` ~30–50% on text-heavy projects. Override at the CLI with `--with-fts` (CLI wins; logs a stderr line on override).",
      ),
    boundaries: z
      .array(
        z
          .object({
            name: z
              .string()
              .min(1)
              .describe(
                "Stable identifier surfaced in `boundary-violations` rows + SARIF rule.id suffix.",
              ),
            from_glob: z
              .string()
              .min(1)
              .describe(
                "SQLite GLOB matched against `dependencies.from_path` (the file doing the import).",
              ),
            to_glob: z
              .string()
              .min(1)
              .describe(
                "SQLite GLOB matched against `dependencies.to_path` (the file being imported).",
              ),
            action: z
              .enum(["deny", "allow"])
              .optional()
              .describe(
                "`deny` rules surface as violations; `allow` rules reserve the slot for future whitelist semantics. Defaults to `deny` when omitted.",
              ),
          })
          .strict(),
      )
      .optional()
      .describe(
        "Architecture-boundary rules. Each row is reconciled into the `boundary_rules` table at index time and joined against `dependencies` by the bundled `boundary-violations` recipe.",
      ),
  })
  .strict();

/**
 * Inferred from {@link codemapUserConfigSchema}.
 */
export type CodemapUserConfig = z.infer<typeof codemapUserConfigSchema>;

function formatCodemapConfigError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

/**
 * Fully resolved config (defaults filled, paths absolute) — stored in the
 * process-global runtime by {@link initCodemap} and read by every layer.
 */
export interface ResolvedCodemapConfig {
  /** Absolute project root (from CLI `--root`, env, or `process.cwd()`). */
  readonly root: string;
  /**
   * Absolute path to the codemap state directory (`<root>/.codemap` by default).
   * Overridable via `--state-dir <path>` or `CODEMAP_STATE_DIR`. Holds every
   * codemap-managed file: `index.db` (+ WAL/SHM), `audit-cache/`, `recipes/`,
   * `config.{ts,js,json}`, `.gitignore` (self-managed).
   */
  readonly stateDir: string;
  /** Absolute path to the SQLite database file (default `<stateDir>/index.db`). */
  readonly databasePath: string;
  /** Glob patterns relative to `root`; either user-supplied or {@link DEFAULT_INCLUDE_PATTERNS}. */
  readonly include: readonly string[];
  /** Directory **names** (any segment) to skip — either user-supplied or {@link DEFAULT_EXCLUDE_DIR_NAMES}. */
  readonly excludeDirNames: ReadonlySet<string>;
  /** Absolute path to `tsconfig.json` for alias resolution, or `null` to disable. */
  readonly tsconfigPath: string | null;
  /**
   * FTS5 full-text indexing toggle. `true` populates the `source_fts`
   * virtual table at index time; `false` (default) leaves it empty.
   * Resolved from `.codemap/config.ts` `fts5` plus the `--with-fts` CLI
   * flag; CLI wins. See `docs/plans/fts5-mermaid.md`.
   */
  readonly fts5: boolean;
  /**
   * Reconciled into the `boundary_rules` table on every index pass. The
   * bundled `boundary-violations` recipe joins this against `dependencies`
   * via SQLite GLOB.
   */
  readonly boundaries: ReadonlyArray<{
    readonly name: string;
    readonly from_glob: string;
    readonly to_glob: string;
    readonly action: "deny" | "allow";
  }>;
}

/**
 * Runtime validation for {@link CodemapUserConfig} (from JSON, `defineConfig`, or API).
 *
 * @throws TypeError when the shape is invalid or unknown keys are present.
 */
export function parseCodemapUserConfig(config: unknown): CodemapUserConfig {
  const result = codemapUserConfigSchema.safeParse(config);
  if (!result.success) {
    throw new TypeError(
      `Codemap config: ${formatCodemapConfigError(result.error)}`,
    );
  }
  return result.data;
}

/**
 * Helper for `export default defineConfig({ ... })` in `.codemap/config.ts`.
 */
export function defineConfig(config: CodemapUserConfig): CodemapUserConfig {
  return parseCodemapUserConfig(config);
}

export interface ResolveCodemapConfigOpts {
  /**
   * Pre-resolved state-dir (from CLI `--state-dir` or `CODEMAP_STATE_DIR`).
   * When omitted the default `<root>/.codemap` is used. Resolved at the
   * bootstrap layer (NOT via the user config — the config file lives
   * inside `<state-dir>/` so we'd hit a chicken-and-egg).
   */
  stateDir?: string | undefined;
  /**
   * CLI override for `fts5` — when `true`, forces the toggle on
   * regardless of `.codemap/config.ts`. When `undefined` (default), the
   * config value (or false default) wins. Set by `--with-fts` argv
   * parsing in the bootstrap layer.
   */
  fts5Cli?: boolean | undefined;
}

/**
 * Merge user config with defaults (absolute paths, default DB location, tsconfig discovery).
 *
 * Three-arg form (`opts.stateDir`) lets the bootstrap pass the resolved
 * state directory through; legacy two-arg call sites keep working with the
 * default `<root>/.codemap`. User-supplied `databasePath` (escape hatch for
 * non-standard layouts) wins over the state-dir derivation.
 */
export function resolveCodemapConfig(
  root: string,
  user: CodemapUserConfig | undefined,
  opts: ResolveCodemapConfigOpts = {},
): ResolvedCodemapConfig {
  const parsed = user !== undefined ? parseCodemapUserConfig(user) : undefined;
  const absRoot = resolve(root);
  const stateDir = opts.stateDir
    ? resolve(opts.stateDir)
    : resolveStateDir({ root: absRoot });
  const databasePath = parsed?.databasePath
    ? resolve(absRoot, parsed.databasePath)
    : join(stateDir, STATE_DB_NAME);
  const include = parsed?.include?.length
    ? [...parsed.include]
    : [...DEFAULT_INCLUDE_PATTERNS];
  const excludeDirNames = new Set<string>(
    parsed?.excludeDirNames?.length
      ? parsed.excludeDirNames
      : DEFAULT_EXCLUDE_DIR_NAMES,
  );
  let tsconfigPath: string | null;
  if (parsed?.tsconfigPath === null) {
    tsconfigPath = null;
  } else if (parsed?.tsconfigPath) {
    tsconfigPath = resolve(absRoot, parsed.tsconfigPath);
  } else {
    const d = join(absRoot, "tsconfig.json");
    tsconfigPath = existsSync(d) ? d : null;
  }

  // CLI > config (mirrors `--root` / `--state-dir`); explicit log on
  // override so quiet-divergence from `.codemap/config.ts` is visible.
  let fts5: boolean;
  if (opts.fts5Cli === true) {
    fts5 = true;
    if (parsed?.fts5 === false) {
      console.error("[fts5] CLI override: enabled despite config fts5=false");
    }
  } else {
    fts5 = parsed?.fts5 === true;
  }

  const boundaries = (parsed?.boundaries ?? []).map((rule) => ({
    name: rule.name,
    from_glob: rule.from_glob,
    to_glob: rule.to_glob,
    action: rule.action ?? "deny",
  }));

  return {
    root: absRoot,
    stateDir,
    databasePath,
    include,
    excludeDirNames,
    tsconfigPath,
    fts5,
    boundaries,
  };
}

/**
 * Load `<state-dir>/config.{ts,js,json}` (D8 order) — or `explicitPath`
 * when CLI `--config` is set. Pre-v1: legacy `<root>/codemap.config.{ts,json}`
 * paths are not searched; the changelog notes the one-line move.
 *
 * Three-arg form (`opts.stateDir`) lets the bootstrap pass the resolved
 * state directory through; legacy two-arg form (`loadUserConfig(root)`)
 * defaults to `<root>/.codemap/`.
 */
export async function loadUserConfig(
  root: string,
  explicitPath?: string,
  opts: { stateDir?: string | undefined } = {},
): Promise<CodemapUserConfig | undefined> {
  const tryImport = async (
    file: string,
  ): Promise<CodemapUserConfig | undefined> => {
    if (!existsSync(file)) return undefined;
    const mod = await import(pathToFileURL(file).href);
    const def = mod.default;
    if (typeof def === "function") {
      const out = await def();
      return out as CodemapUserConfig;
    }
    if (def && typeof def === "object") {
      return def as CodemapUserConfig;
    }
    return undefined;
  };

  if (explicitPath) {
    if (explicitPath.endsWith(".json")) {
      if (!existsSync(explicitPath)) return undefined;
      const raw = await readJsonFile(explicitPath);
      return raw as CodemapUserConfig;
    }
    return tryImport(explicitPath);
  }

  const stateDir = opts.stateDir ?? resolveStateDir({ root });
  for (const basename of STATE_CONFIG_BASENAMES) {
    const candidate = join(stateDir, basename);
    if (basename.endsWith(".json")) {
      if (existsSync(candidate)) {
        const raw = await readJsonFile(candidate);
        return raw as CodemapUserConfig;
      }
      continue;
    }
    const fromImport = await tryImport(candidate);
    if (fromImport) return fromImport;
  }

  return undefined;
}
