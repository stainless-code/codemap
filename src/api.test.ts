import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCodemap } from "./api";
import { installCodemapTestTeardown } from "./test-helpers/runtime-reset";

installCodemapTestTeardown();

describe("createCodemap", () => {
  test("query runs against the index database", async () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-api-"));
    writeFileSync(join(root, "package.json"), "{}");
    const cm = await createCodemap({ root });
    const rows = cm.query("SELECT 1 as ok") as { ok: number }[];
    expect(rows[0]?.ok).toBe(1);
  });

  test("throws when switching to a different root in the same process", async () => {
    const rootA = mkdtempSync(join(tmpdir(), "codemap-api-a-"));
    const rootB = mkdtempSync(join(tmpdir(), "codemap-api-b-"));
    writeFileSync(join(rootA, "package.json"), "{}");
    writeFileSync(join(rootB, "package.json"), "{}");
    await createCodemap({ root: rootA });
    await expect(createCodemap({ root: rootB })).rejects.toThrow(
      /cannot switch project root/,
    );
  });

  test("throws when config file is invalid at load", async () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-api-bad-"));
    const configPath = join(root, "bad.json");
    writeFileSync(configPath, JSON.stringify({ include: [1, 2] }));
    await expect(
      createCodemap({ root, configFile: configPath }),
    ).rejects.toThrow(/include/);
  });
});
