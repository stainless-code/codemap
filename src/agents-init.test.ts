import { describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureGitignoreCodemapPattern,
  resolveAgentsTemplateDir,
  runAgentsInit,
  targetsNeedLinkMode,
} from "./agents-init";

describe("runAgentsInit", () => {
  it("copies templates into .agents/", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      const ok = runAgentsInit({ projectRoot: dir, force: true });
      expect(ok).toBe(true);
      const skill = readFileSync(
        join(dir, ".agents", "skills", "codemap", "SKILL.md"),
        "utf-8",
      );
      expect(skill.length).toBeGreaterThan(100);
      expect(
        readFileSync(join(dir, ".agents", "rules", "codemap.mdc"), "utf-8"),
      ).toContain("codemap");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns false when .agents exists without force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      mkdirSync(join(dir, ".agents"), { recursive: true });
      expect(runAgentsInit({ projectRoot: dir, force: false })).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolveAgentsTemplateDir points at templates/agents", () => {
    const p = resolveAgentsTemplateDir().replace(/\\/g, "/");
    expect(p.endsWith("/templates/agents")).toBe(true);
  });

  it("ensureGitignoreCodemapPattern appends .codemap.* when .gitignore exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      mkdirSync(join(dir, ".git"), { recursive: true });
      const gi = join(dir, ".gitignore");
      writeFileSync(gi, "node_modules/\n", "utf-8");
      ensureGitignoreCodemapPattern(dir);
      expect(readFileSync(gi, "utf-8")).toContain(".codemap.*");
      ensureGitignoreCodemapPattern(dir);
      const lines = readFileSync(gi, "utf-8").split("\n").filter(Boolean);
      expect(lines.filter((l) => l === ".codemap.*").length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureGitignoreCodemapPattern no-ops when not a Git repo", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      ensureGitignoreCodemapPattern(dir);
      expect(existsSync(join(dir, ".gitignore"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ensureGitignoreCodemapPattern creates .gitignore when Git repo has none", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      mkdirSync(join(dir, ".git"), { recursive: true });
      ensureGitignoreCodemapPattern(dir);
      expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toBe(
        ".codemap.*\n",
      );
      ensureGitignoreCodemapPattern(dir);
      expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toBe(
        ".codemap.*\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAgentsInit updates .gitignore when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      mkdirSync(join(dir, ".git"), { recursive: true });
      writeFileSync(join(dir, ".gitignore"), "dist/\n", "utf-8");
      expect(runAgentsInit({ projectRoot: dir, force: true })).toBe(true);
      expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toContain(
        ".codemap.*",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAgentsInit creates .gitignore in Git repo without one", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      mkdirSync(join(dir, ".git"), { recursive: true });
      expect(runAgentsInit({ projectRoot: dir, force: true })).toBe(true);
      expect(readFileSync(join(dir, ".gitignore"), "utf-8")).toBe(
        ".codemap.*\n",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAgentsInit with Cursor target copies into .cursor/", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      expect(
        runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["cursor"],
          linkMode: "copy",
        }),
      ).toBe(true);
      expect(
        readFileSync(join(dir, ".cursor", "rules", "codemap.mdc"), "utf-8"),
      ).toContain("codemap");
      expect(
        readFileSync(
          join(dir, ".cursor", "skills", "codemap", "SKILL.md"),
          "utf-8",
        ).length,
      ).toBeGreaterThan(100);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAgentsInit with claude-md writes CLAUDE.md", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      expect(
        runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["claude-md"],
        }),
      ).toBe(true);
      expect(readFileSync(join(dir, "CLAUDE.md"), "utf-8")).toContain(
        "Codemap",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("targetsNeedLinkMode is true only for symlink-style integrations", () => {
    expect(targetsNeedLinkMode([])).toBe(false);
    expect(targetsNeedLinkMode(["claude-md", "copilot"])).toBe(false);
    expect(targetsNeedLinkMode(["cursor"])).toBe(true);
    expect(targetsNeedLinkMode(["windsurf", "agents-md"])).toBe(true);
  });

  it("runAgentsInit writes Copilot and pointer files", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      expect(
        runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["copilot", "agents-md", "gemini-md"],
        }),
      ).toBe(true);
      expect(
        readFileSync(join(dir, ".github", "copilot-instructions.md"), "utf-8"),
      ).toContain("Copilot");
      expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toContain(
        "Codemap",
      );
      expect(readFileSync(join(dir, "GEMINI.md"), "utf-8")).toContain(
        "Codemap",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAgentsInit with Windsurf copies .windsurf/rules", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      expect(
        runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["windsurf"],
          linkMode: "copy",
        }),
      ).toBe(true);
      expect(
        readFileSync(join(dir, ".windsurf", "rules", "codemap.mdc"), "utf-8"),
      ).toContain("codemap");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAgentsInit refuses Cursor wiring when .cursor/rules exists without force", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      mkdirSync(join(dir, ".cursor", "rules"), { recursive: true });
      writeFileSync(join(dir, ".cursor", "rules", "x.mdc"), "", "utf-8");
      expect(() =>
        runAgentsInit({
          projectRoot: dir,
          force: false,
          targets: ["cursor"],
          linkMode: "copy",
        }),
      ).toThrow(/\.cursor\/rules already exists/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
