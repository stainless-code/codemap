import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createCodemap } from "./api";

describe("createCodemap", () => {
  test("query runs against the index database", async () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-api-"));
    writeFileSync(join(root, "package.json"), "{}");
    const cm = await createCodemap({ root });
    const rows = cm.query("SELECT 1 as ok") as { ok: number }[];
    expect(rows[0]?.ok).toBe(1);
  });
});
