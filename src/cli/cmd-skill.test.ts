import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assembleAgentContent,
  checkConsumerPointers,
  EXPECTED_POINTER_VERSION,
} from "../application/agent-content";

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

describe("checkConsumerPointers (staleness detection)", () => {
  function seedSkill(root: string, body: string): void {
    const dir = join(root, ".agents", "skills", "codemap");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), body, "utf8");
  }

  it("returns no entries when .agents/ is empty", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    expect(checkConsumerPointers(root)).toEqual([]);
  });

  it("flags a stamped-but-old pointer as stale by version", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    seedSkill(root, "# Pointer\n\n<!-- codemap-pointer-version: 0 -->\n");
    const [status] = checkConsumerPointers(root);
    expect(status?.presentVersion).toBe(0);
    expect(status?.looksLegacy).toBe(false);
    expect(status!.presentVersion! < EXPECTED_POINTER_VERSION).toBe(true);
  });

  it("flags a fat unstamped file as legacy", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    seedSkill(root, "x\n".repeat(100));
    const [status] = checkConsumerPointers(root);
    expect(status?.presentVersion).toBeNull();
    expect(status?.looksLegacy).toBe(true);
  });

  it("does not flag a short unstamped user-managed file", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    seedSkill(root, "# My own skill\n\nNothing to see here.\n");
    const [status] = checkConsumerPointers(root);
    expect(status?.presentVersion).toBeNull();
    expect(status?.looksLegacy).toBe(false);
  });

  it("accepts the current bundled pointer as fresh", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-pointer-"));
    seedSkill(
      root,
      `<!-- codemap-pointer-version: ${EXPECTED_POINTER_VERSION} -->\n`,
    );
    const [status] = checkConsumerPointers(root);
    expect(status?.presentVersion).toBe(EXPECTED_POINTER_VERSION);
  });
});
