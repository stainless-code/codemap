import { ResolverFactory } from "oxc-resolver";

import { projectRelativePathFromResolved } from "./application/path-containment";
import type { ImportRow, DependencyRow } from "./db";

let _projectRoot: string | null = null;
let _tsconfigPath: string | null = null;
let _resolver: ResolverFactory | null = null;

/**
 * Wire oxc-resolver to the project root and optional `tsconfig.json`.
 * Call after `initCodemap()` (CLI and `createCodemap` do this for you).
 */
export function configureResolver(
  projectRoot: string,
  tsconfigPath: string | null,
): void {
  _projectRoot = projectRoot;
  _tsconfigPath = tsconfigPath;
  _resolver = null;
}

function getResolver(): ResolverFactory {
  if (!_projectRoot) {
    throw new Error(
      "Codemap: configureResolver() must run before resolving imports",
    );
  }
  if (!_resolver) {
    const options: ConstructorParameters<typeof ResolverFactory>[0] = {
      conditionNames: ["node", "import"],
      extensions: [
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".json",
        ".css",
      ],
      mainFields: ["module", "main"],
    };
    if (_tsconfigPath) {
      options.tsconfig = { configFile: _tsconfigPath };
    }
    _resolver = new ResolverFactory(options);
  }
  return _resolver;
}

/**
 * Resolve static imports, mutating each row's `resolved_path`, and collect `dependencies`
 * edges only when the target path is in `indexedPaths` (project files).
 */
export function resolveImports(
  absoluteFilePath: string,
  imports: ImportRow[],
  indexedPaths: Set<string>,
): DependencyRow[] {
  const root = _projectRoot!;
  const resolver = getResolver();
  const deps: DependencyRow[] = [];

  for (const imp of imports) {
    try {
      const result = resolver.resolveFileSync(absoluteFilePath, imp.source);
      if (result.path) {
        const relResolved = projectRelativePathFromResolved(root, result.path);
        if (relResolved === null) continue;

        imp.resolved_path = relResolved;

        // Only track dependencies to files within our indexed set
        if (indexedPaths.has(relResolved)) {
          deps.push({ from_path: imp.file_path, to_path: relResolved });
        }
      }
    } catch {
      // External package or unresolvable — leave resolved_path as null
    }
  }

  return deps;
}

/** Resolve a string module specifier from `absoluteFilePath`; null when external/unresolvable. */
export function resolveModuleSpecifier(
  absoluteFilePath: string,
  source: string,
): string | null {
  const root = _projectRoot!;
  const resolver = getResolver();
  try {
    const result = resolver.resolveFileSync(absoluteFilePath, source);
    if (!result.path) return null;
    return projectRelativePathFromResolved(root, result.path);
  } catch {
    return null;
  }
}
