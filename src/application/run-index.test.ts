import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { configureResolver } from "../resolver";
import { initCodemap } from "../runtime";
import { openCodemapDatabase } from "../sqlite-db";
import { runCodemapIndex } from "./run-index";

describe("runCodemapIndex", () => {
  test("incremental on empty DB creates schema first (no missing meta table)", async () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-run-index-"));
    writeFileSync(join(root, "package.json"), "{}");
    initCodemap(resolveCodemapConfig(root, {}));
    configureResolver(root, null);

    const db = openCodemapDatabase(":memory:");
    try {
      await expect(
        runCodemapIndex(db, { mode: "incremental", quiet: true }),
      ).resolves.toBeDefined();
    } finally {
      db.close();
    }
  });
});
