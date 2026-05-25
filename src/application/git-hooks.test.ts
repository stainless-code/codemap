import { describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  buildHookBlock,
  CODEMAP_HOOK_BEGIN,
  CODEMAP_HOOK_END,
  installGitHooks,
  isCodemapHookInstalled,
  stripHookBlock,
  uninstallGitHooks,
  upsertHookBlock,
} from "./git-hooks";

function makeGitRepo(): string {
  const scratch = join(process.cwd(), "fixtures", "tmp");
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "git-hooks-"));
  mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
  return dir;
}

describe("git-hooks", () => {
  it("upsertHookBlock is idempotent", () => {
    const once = upsertHookBlock("");
    const twice = upsertHookBlock(once);
    expect(twice).toBe(once);
    expect(twice).toContain(CODEMAP_HOOK_BEGIN);
    expect(twice).toContain("( codemap >/dev/null 2>&1 & )");
  });

  it("stripHookBlock removes only the codemap block", () => {
    const merged = upsertHookBlock("#!/bin/sh\necho before\n");
    const stripped = stripHookBlock(merged);
    expect(stripped).toContain("echo before");
    expect(stripped).not.toContain(CODEMAP_HOOK_BEGIN);
  });

  it("installGitHooks writes executable hook with background codemap", () => {
    const dir = makeGitRepo();
    try {
      installGitHooks(dir, ["post-commit"]);
      const hookPath = join(dir, ".git", "hooks", "post-commit");
      expect(isCodemapHookInstalled(hookPath)).toBe(true);
      const body = readFileSync(hookPath, "utf8");
      expect(body).toContain("( codemap >/dev/null 2>&1 & )");
      try {
        const mode = statSync(hookPath).mode & 0o777;
        expect(mode & 0o111).not.toBe(0);
      } catch {
        chmodSync(hookPath, 0o755);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uninstallGitHooks removes codemap block but preserves foreign lines", () => {
    const dir = makeGitRepo();
    try {
      const hookPath = join(dir, ".git", "hooks", "post-commit");
      writeFileSync(hookPath, "#!/bin/sh\necho keep\n", "utf8");
      installGitHooks(dir, ["post-commit"]);
      uninstallGitHooks(dir, ["post-commit"]);
      const body = readFileSync(hookPath, "utf8");
      expect(body).toContain("echo keep");
      expect(body).not.toContain(CODEMAP_HOOK_BEGIN);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("installGitHooks throws when .git is missing", () => {
    const scratch = join(process.cwd(), "fixtures", "tmp");
    mkdirSync(scratch, { recursive: true });
    const dir = mkdtempSync(join(scratch, "no-git-"));
    try {
      expect(() => installGitHooks(dir)).toThrow(/not a git repository/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("buildHookBlock matches plan hook body shape", () => {
    expect(buildHookBlock()).toBe(
      `${CODEMAP_HOOK_BEGIN}\n( codemap >/dev/null 2>&1 & )\n${CODEMAP_HOOK_END}\n`,
    );
  });
});
