import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
 * User configuration from `codemap.config.ts` / `.json`, CLI, or `createCodemap({ config })`.
 */
export interface CodemapUserConfig {
  /** Project root. Defaults via CLI `--root` or `process.cwd()`. */
  root?: string;
  /** SQLite database path, relative to root or absolute. Default: `<root>/.codemap.db`. */
  databasePath?: string;
  /** Glob patterns relative to root; replaces {@link DEFAULT_INCLUDE_PATTERNS} when set. */
  include?: string[];
  /** Directory name segments to skip; replaces {@link DEFAULT_EXCLUDE_DIR_NAMES} when set. */
  excludeDirNames?: string[];
  /**
   * Path to `tsconfig.json` for import alias resolution (oxc-resolver).
   * Use `null` to disable. Default: `<root>/tsconfig.json` if the file exists.
   */
  tsconfigPath?: string | null;
}

/**
 * Fully resolved configuration after {@link resolveCodemapConfig}.
 */
export interface ResolvedCodemapConfig {
  readonly root: string;
  readonly databasePath: string;
  readonly include: readonly string[];
  readonly excludeDirNames: ReadonlySet<string>;
  readonly tsconfigPath: string | null;
}

/**
 * Helper for `export default defineConfig({ ... })` in `codemap.config.ts`.
 */
export function defineConfig(config: CodemapUserConfig): CodemapUserConfig {
  return config;
}

/**
 * Merge user config with defaults (absolute paths, default DB location, tsconfig discovery).
 */
export function resolveCodemapConfig(
  root: string,
  user: CodemapUserConfig | undefined,
): ResolvedCodemapConfig {
  const absRoot = resolve(root);
  const databasePath = user?.databasePath
    ? resolve(absRoot, user.databasePath)
    : join(absRoot, ".codemap.db");
  const include = user?.include?.length
    ? [...user.include]
    : [...DEFAULT_INCLUDE_PATTERNS];
  const excludeDirNames = new Set<string>(
    user?.excludeDirNames?.length
      ? user.excludeDirNames
      : DEFAULT_EXCLUDE_DIR_NAMES,
  );
  let tsconfigPath: string | null;
  if (user?.tsconfigPath === null) {
    tsconfigPath = null;
  } else if (user?.tsconfigPath) {
    tsconfigPath = resolve(absRoot, user.tsconfigPath);
  } else {
    const d = join(absRoot, "tsconfig.json");
    tsconfigPath = existsSync(d) ? d : null;
  }

  return {
    root: absRoot,
    databasePath,
    include,
    excludeDirNames,
    tsconfigPath,
  };
}

/**
 * Load optional `codemap.config.ts` / `codemap.config.json` from the project root,
 * or from `explicitPath` (CLI `--config`).
 */
export async function loadUserConfig(
  root: string,
  explicitPath?: string,
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

  const tsConfig = join(root, "codemap.config.ts");
  const fromTs = await tryImport(tsConfig);
  if (fromTs) return fromTs;

  const jsonPath = join(root, "codemap.config.json");
  if (existsSync(jsonPath)) {
    const raw = await readJsonFile(jsonPath);
    return raw as CodemapUserConfig;
  }

  return undefined;
}
