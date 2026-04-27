import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

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
 * Zod schema for user config (`codemap.config.*`, `defineConfig`, API).
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
        "SQLite database path, relative to root or absolute. Default: `<root>/.codemap.db`.",
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
 * Fully resolved configuration after {@link resolveCodemapConfig} — defaults
 * filled in, paths absolute, types narrowed. Stored in the process-global
 * runtime by {@link initCodemap} and read by every layer that needs project
 * context (workers, resolver, DB, glob).
 */
export interface ResolvedCodemapConfig {
  /** Absolute project root (from CLI `--root`, env, or `process.cwd()`). */
  readonly root: string;
  /** Absolute path to the SQLite database file (default `<root>/.codemap.db`). */
  readonly databasePath: string;
  /** Glob patterns relative to `root`; either user-supplied or {@link DEFAULT_INCLUDE_PATTERNS}. */
  readonly include: readonly string[];
  /** Directory **names** (any segment) to skip — either user-supplied or {@link DEFAULT_EXCLUDE_DIR_NAMES}. */
  readonly excludeDirNames: ReadonlySet<string>;
  /** Absolute path to `tsconfig.json` for alias resolution, or `null` to disable. */
  readonly tsconfigPath: string | null;
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
 * Helper for `export default defineConfig({ ... })` in `codemap.config.ts`.
 */
export function defineConfig(config: CodemapUserConfig): CodemapUserConfig {
  return parseCodemapUserConfig(config);
}

/**
 * Merge user config with defaults (absolute paths, default DB location, tsconfig discovery).
 */
export function resolveCodemapConfig(
  root: string,
  user: CodemapUserConfig | undefined,
): ResolvedCodemapConfig {
  const parsed = user !== undefined ? parseCodemapUserConfig(user) : undefined;
  const absRoot = resolve(root);
  const databasePath = parsed?.databasePath
    ? resolve(absRoot, parsed.databasePath)
    : join(absRoot, ".codemap.db");
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
