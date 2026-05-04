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

export function getStateDir(): string {
  return getCodemapConfig().stateDir;
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

export function getFts5Enabled(): boolean {
  return getCodemapConfig().fts5;
}

/** True if any path segment matches an excluded directory name (e.g. `node_modules`). */
export function isPathExcluded(relPath: string): boolean {
  const set = getExcludeDirNames();
  let start = 0;
  for (let i = 0; i <= relPath.length; i++) {
    const ch = i < relPath.length ? relPath.charCodeAt(i) : 0;
    if (ch === 47 || ch === 92 || i === relPath.length) {
      if (i > start && set.has(relPath.slice(start, i))) return true;
      start = i + 1;
    }
  }
  return false;
}
