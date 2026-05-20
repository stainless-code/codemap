import { describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseWorkerInput } from "./parse-worker-core";

describe("parseWorkerInput", () => {
  it("returns error ParsedFile when stat fails after a successful read", () => {
    const root = mkdtempSync(join(tmpdir(), "parse-worker-"));
    const rel = "src/a.ts";
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, rel), "export const a = 1;\n");

    const statSpy = spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });
    try {
      const { results } = parseWorkerInput({ files: [rel], projectRoot: root });
      expect(results).toHaveLength(1);
      expect(results[0]?.error).toBe(true);
      expect(results[0]?.relPath).toBe(rel);
    } finally {
      statSpy.mockRestore();
    }
  });
});
