import { globSync as tinyglobbySync } from "tinyglobby";

export interface GlobOptions {
  /** Glob patterns to skip (e.g. `["**\/node_modules/**", "**\/.git/**"]`). */
  readonly ignore?: readonly string[];
}

/**
 * Glob files relative to `cwd` (dotfiles included). `ignore` patterns prune
 * subtrees up-front (~12× vs walk + post-filter on `node_modules` etc.).
 * tinyglobby on both runtimes — `Bun.Glob` has no `ignore` option.
 */
export function globSync(
  pattern: string | readonly string[],
  cwd: string,
  options?: GlobOptions,
): string[] {
  return tinyglobbySync(pattern as string | string[], {
    cwd,
    dot: true,
    absolute: false,
    expandDirectories: false,
    // tinyglobby follows-by-default (Bun.Glob + node:fs.globSync skip);
    // without this `.cursor/rules/*` → `.agents/rules/*` get indexed twice.
    followSymbolicLinks: false,
    ignore: options?.ignore as string[] | undefined,
  });
}
