import fg from "fast-glob";

/**
 * Glob files relative to `cwd` (dotfiles included). On Bun uses `Glob` from `bun`;
 * on Node uses `fast-glob` for identical published behavior.
 */
export function globSync(pattern: string, cwd: string): string[] {
  if (typeof Bun !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Glob } = require("bun") as typeof import("bun");
    const glob = new Glob(pattern);
    return Array.from(glob.scanSync({ cwd, dot: true }));
  }
  return fg.sync(pattern, { cwd, dot: true, absolute: false });
}
