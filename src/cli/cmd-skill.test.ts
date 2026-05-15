import { describe, expect, it } from "bun:test";

import { assembleAgentContent } from "../application/agent-content";

describe("agent content fetch surfaces", () => {
  it("assembles the skill from section files", () => {
    const text = assembleAgentContent("skill");
    expect(text).toContain("name: codemap");
    expect(text.length).toBeGreaterThan(500);
  });

  it("assembles the rule from section files", () => {
    const text = assembleAgentContent("rule");
    expect(text).toContain("alwaysApply: true");
    expect(text.length).toBeGreaterThan(500);
  });
});
