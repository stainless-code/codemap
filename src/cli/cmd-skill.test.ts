import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { resolveAgentContentPath } from "./cmd-skill";

describe("resolveAgentContentPath", () => {
  it("resolves the bundled SKILL.md", () => {
    const text = readFileSync(resolveAgentContentPath("skill"), "utf8");
    expect(text).toContain("name: codemap");
    expect(text.length).toBeGreaterThan(500);
  });

  it("resolves the bundled rule markdown", () => {
    const text = readFileSync(resolveAgentContentPath("rule"), "utf8");
    expect(text).toContain("alwaysApply: true");
    expect(text.length).toBeGreaterThan(500);
  });
});
