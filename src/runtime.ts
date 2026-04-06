import type { ResolvedCodemapConfig } from "./config";

let _config: ResolvedCodemapConfig | null = null;

/**
 * Store resolved config for the current process (`getProjectRoot`, `openDb`, etc.).
 * Must run before indexing or `openDb()`; typically via `createCodemap` or the CLI.
 */
export function initCodemap(config: ResolvedCodemapConfig): void {
  _config = config;
}

export function getCodemapConfig(): ResolvedCodemapConfig {
  if (!_config) {
    throw new Error(
      "Codemap: not initialized — call initCodemap() after resolving config",
    );
  }
  return _config;
}

export function getProjectRoot(): string {
  return getCodemapConfig().root;
}

export function getDatabasePath(): string {
  return getCodemapConfig().databasePath;
}

export function getIncludePatterns(): readonly string[] {
  return getCodemapConfig().include;
}

export function getExcludeDirNames(): ReadonlySet<string> {
  return getCodemapConfig().excludeDirNames;
}

export function getTsconfigPath(): string | null {
  return getCodemapConfig().tsconfigPath;
}

/** True if any path segment matches an excluded directory name (e.g. `node_modules`). */
export function isPathExcluded(relPath: string): boolean {
  const parts = relPath.split(/[/\\]/).filter(Boolean);
  const set = getExcludeDirNames();
  return parts.some((p) => set.has(p));
}
