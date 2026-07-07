import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("package.json publish scripts", () => {
  test("prepublishOnly uses the same validation gate as check plus pack validation", () => {
    expect(pkg.scripts.prepublishOnly).toContain("bun run check");
    expect(pkg.scripts.prepublishOnly).toContain("check:pack");
    expect(pkg.scripts.check).toContain("typecheck");
    expect(pkg.scripts.check).toContain("test");
    expect(pkg.scripts.check).toContain("test:golden");
    expect(pkg.scripts.check).toContain("test:agent-eval");
  });
});
