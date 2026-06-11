import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let cached: boolean | undefined;

/** `false` when the environment cannot create symlinks (e.g. Windows without privilege). */
export function canCreateSymlinks(): boolean {
  if (cached !== undefined) return cached;
  const dir = mkdtempSync(join(tmpdir(), "codemap-symlink-cap-"));
  try {
    writeFileSync(join(dir, "target.txt"), "x\n");
    symlinkSync(join(dir, "target.txt"), join(dir, "link.txt"));
    cached = true;
  } catch {
    cached = false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return cached;
}
