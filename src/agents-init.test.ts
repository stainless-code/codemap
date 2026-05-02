import { describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CODMAP_POINTER_BEGIN,
  CODMAP_POINTER_END,
  ensureGitignoreCodemapPattern,
  listRegularFilesRecursive,
  relPathToAbsSegments,
  resolveAgentsTemplateDir,
  runAgentsInit,
  targetsNeedLinkMode,
  upsertCodemapPointerFile,
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
        readFileSync(join(dir, ".agents", "rules", "codemap.md"), "utf-8"),
      ).toContain("codemap");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runAgentsInit with --force refreshes only template file paths; user files under rules/ and skills/ remain", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      mkdirSync(join(dir, ".agents", "rules"), { recursive: true });
      mkdirSync(join(dir, ".agents", "skills", "stale"), { recursive: true });
      writeFileSync(join(dir, ".agents", "USER_NOTES.md"), "keep me", "utf-8");
      writeFileSync(
        join(dir, ".agents", "rules", "stale.txt"),
        "user rule",
        "utf-8",
      );
      writeFileSync(
        join(dir, ".agents", "skills", "stale", "SKILL.md"),
        "user skill",
        "utf-8",
      );
      expect(runAgentsInit({ projectRoot: dir, force: true })).toBe(true);
      expect(readFileSync(join(dir, ".agents", "USER_NOTES.md"), "utf-8")).toBe(
        "keep me",
      );
      expect(
        readFileSync(join(dir, ".agents", "rules", "stale.txt"), "utf-8"),
      ).toBe("user rule");
      expect(
        readFileSync(
          join(dir, ".agents", "skills", "stale", "SKILL.md"),
          "utf-8",
        ),
      ).toBe("user skill");
      expect(
        readFileSync(join(dir, ".agents", "rules", "codemap.md"), "utf-8"),
      ).toContain("codemap");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("listRegularFilesRecursive matches bundled rules and skills files", () => {
    const root = resolveAgentsTemplateDir();
    const rules = listRegularFilesRecursive(join(root, "rules")).sort();
    const skills = listRegularFilesRecursive(join(root, "skills")).sort();
    expect(rules).toContain("codemap.md");
    expect(skills).toContain("codemap/SKILL.md");
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

  it("runAgentsInit with Cursor symlink creates per-file symlinks, not directory symlinks", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-agents-"));
    try {
      expect(
        runAgentsInit({
          projectRoot: dir,
          force: true,
          targets: ["cursor"],
          linkMode: "symlink",
        }),
      ).toBe(true);
      const rulesDir = join(dir, ".cursor", "rules");
      const skillsDir = join(dir, ".cursor", "skills");
      expect(lstatSync(rulesDir).isSymbolicLink()).toBe(false);
      expect(lstatSync(skillsDir).isSymbolicLink()).toBe(false);
      expect(lstatSync(rulesDir).isDirectory()).toBe(true);
      expect(lstatSync(skillsDir).isDirectory()).toBe(true);
      for (const rel of listRegularFilesRecursive(
        join(dir, ".agents", "rules"),
      )) {
        const cursorRel = rel.endsWith(".md") ? rel.slice(0, -3) + ".mdc" : rel;
        expect(
          lstatSync(
            join(dir, ".cursor", "rules", ...cursorRel.split("/")),
          ).isSymbolicLink(),
        ).toBe(true);
      }
      for (const rel of listRegularFilesRecursive(
        join(dir, ".agents", "skills"),
      )) {
        expect(
          lstatSync(
            join(dir, ".cursor", "skills", ...rel.split("/")),
          ).isSymbolicLink(),
        ).toBe(true);
      }
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
      const md = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
      expect(md).toContain("Codemap");
      expect(md).toContain(CODMAP_POINTER_BEGIN);
      expect(md).toContain(CODMAP_POINTER_END);
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
        CODMAP_POINTER_BEGIN,
      );
      expect(readFileSync(join(dir, "GEMINI.md"), "utf-8")).toContain(
        CODMAP_POINTER_BEGIN,
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
        readFileSync(join(dir, ".windsurf", "rules", "codemap.md"), "utf-8"),
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

/** Minimal inner block for pointer tests (matches legacy migration heuristic). */
const POINTER_INNER_TEST = `# Codemap

This project uses [Codemap](https://github.com/stainless-code/codemap) — test.

- **Skill:** \`.agents/skills/codemap/SKILL.md\`
- **CLI:** \`codemap query "SELECT 1"\` for SQL
- **Rules:** \`.agents/rules/\`
`;

function wrapPointerTest(inner: string): string {
  return `${CODMAP_POINTER_BEGIN}\n${inner.trim()}\n${CODMAP_POINTER_END}\n`;
}

describe("upsertCodemapPointerFile", () => {
  it("appends managed section to existing non-Codemap file", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    const p = join(dir, "AGENTS.md");
    try {
      writeFileSync(p, "# Team\n\nOur project.\n", "utf-8");
      upsertCodemapPointerFile(p, POINTER_INNER_TEST, "AGENTS.md", false);
      const out = readFileSync(p, "utf-8");
      expect(out).toContain("# Team");
      expect(out).toContain("Our project.");
      expect(out).toContain(CODMAP_POINTER_BEGIN);
      expect(out.indexOf("# Team")).toBeLessThan(
        out.indexOf(CODMAP_POINTER_BEGIN),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces managed section in place on second run (no duplicate blocks)", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    const p = join(dir, "NOTE.md");
    try {
      writeFileSync(p, wrapPointerTest("FIRST"), "utf-8");
      upsertCodemapPointerFile(
        p,
        "SECOND\n\nstill https://github.com/stainless-code/codemap\n`.agents/skills/codemap`\n`codemap query`",
        "NOTE.md",
        false,
      );
      const out = readFileSync(p, "utf-8");
      expect(out).toContain("SECOND");
      expect(out).not.toContain("FIRST");
      expect(out.match(new RegExp(CODMAP_POINTER_BEGIN, "g"))?.length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates legacy unmarked Codemap pointer file to managed section", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    const p = join(dir, "CLAUDE.md");
    try {
      writeFileSync(p, POINTER_INNER_TEST, "utf-8");
      upsertCodemapPointerFile(
        p,
        `${POINTER_INNER_TEST}\n\n## Extra\n\nMigrated.\n`,
        "CLAUDE.md",
        false,
      );
      const out = readFileSync(p, "utf-8");
      expect(out).toContain(CODMAP_POINTER_BEGIN);
      expect(out).toContain("Migrated.");
      expect(out).not.toContain(`${POINTER_INNER_TEST}\n${POINTER_INNER_TEST}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--force replaces entire file with managed section", () => {
    const dir = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    const p = join(dir, "AGENTS.md");
    try {
      writeFileSync(p, "# Keep me\n\nLots of custom content.\n", "utf-8");
      upsertCodemapPointerFile(p, POINTER_INNER_TEST, "AGENTS.md", true);
      expect(readFileSync(p, "utf-8")).toBe(
        wrapPointerTest(POINTER_INNER_TEST),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("relPathToAbsSegments — defence-in-depth path safety", () => {
  it("returns segments for a normal relative path", () => {
    expect(relPathToAbsSegments("rules/codemap.md")).toEqual([
      "rules",
      "codemap.md",
    ]);
  });

  it("filters empty segments (leading / trailing / double slashes)", () => {
    expect(relPathToAbsSegments("/rules//codemap.md/")).toEqual([
      "rules",
      "codemap.md",
    ]);
  });

  it("rejects `..` segment", () => {
    expect(() => relPathToAbsSegments("../etc/passwd")).toThrow(
      /refusing path with ".." segment/,
    );
  });

  it("rejects `..` segment in the middle of the path", () => {
    expect(() => relPathToAbsSegments("rules/../../etc/passwd")).toThrow(
      /refusing path with ".." segment/,
    );
  });

  it("rejects `.` segment", () => {
    expect(() => relPathToAbsSegments("rules/./codemap.md")).toThrow(
      /refusing path with "." segment/,
    );
  });
});
