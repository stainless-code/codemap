import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resolveAgentsTemplateDir } from "../agents-init";
import { assembleSkill } from "../application/agent-content";

describe("agent content fetch surfaces", () => {
  it("assembleSkill() concatenates the skill section files", () => {
    const text = assembleSkill();
    expect(text).toContain("name: codemap");
    expect(text.length).toBeGreaterThan(500);
  });

  it("bundled rule markdown is reachable on disk", () => {
    const text = readFileSync(
      join(resolveAgentsTemplateDir(), "rules", "codemap.md"),
      "utf8",
    );
    expect(text).toContain("alwaysApply: true");
    expect(text.length).toBeGreaterThan(500);
  });
});
