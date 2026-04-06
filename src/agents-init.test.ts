import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveAgentsTemplateDir, runAgentsInit } from "./agents-init";

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
});
