import { globSync as tinyglobbySync } from "tinyglobby";

export interface GlobOptions {
  /** Glob patterns to skip (e.g. `["**\/node_modules/**", "**\/.git/**"]`). */
  readonly ignore?: readonly string[];
}

/**
 * Glob files relative to `cwd` (dotfiles included). Supports a single pattern
 * or an array; `ignore` patterns prune matching subtrees up-front (~12× faster
 * than walking + post-filtering on big trees with `node_modules` etc.).
 *
 * Uses `tinyglobby` on both Bun and Node — pre-2026-05 Bun went through
 * `Bun.Glob` for native speed, but `Bun.Glob` has no `ignore` option (per
 * <https://bun.sh/docs/api/glob>) so the post-filter walked excluded trees
 * anyway. tinyglobby with `ignore` is faster than `Bun.Glob` without it.
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
    // Preserves pre-2026-05 Bun.Glob behavior — symlinks (e.g. .cursor/rules/*
    // → .agents/rules/*) would otherwise get indexed twice. node:fs.globSync
    // and Bun.Glob both skip-by-default; tinyglobby follows-by-default.
    followSymbolicLinks: false,
    ignore: options?.ignore as string[] | undefined,
  });
}
