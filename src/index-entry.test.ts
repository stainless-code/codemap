import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CLI entry via symlink", () => {
  it("runs when argv[1] is a symlink to src/index.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-entry-"));
    const link = join(dir, "codemap-link");
    const target = join(import.meta.dir, "index.ts");
    symlinkSync(target, link);
    try {
      const r = spawnSync("bun", [link, "--help"], {
        cwd: join(import.meta.dir, ".."),
        encoding: "utf8",
      });
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toContain("codemap");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
