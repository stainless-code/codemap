import { describe, expect, test } from "bun:test";

import { createCodemap } from "./api";

describe("createCodemap", () => {
  test("query runs against the index database", async () => {
    const cm = await createCodemap({ root: process.cwd() });
    const rows = cm.query("SELECT 1 as ok") as { ok: number }[];
    expect(rows[0]?.ok).toBe(1);
  });
});
