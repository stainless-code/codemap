import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_EXCLUDE_DIR_NAMES,
  DEFAULT_INCLUDE_PATTERNS,
  resolveCodemapConfig,
} from "./config";

describe("resolveCodemapConfig", () => {
  it("honors explicit empty include (no default patterns)", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-config-"));
    const cfg = resolveCodemapConfig(root, { include: [] });
    expect(cfg.include).toEqual([]);
    expect(cfg.include).not.toEqual(DEFAULT_INCLUDE_PATTERNS);
  });

  it("honors explicit empty excludeDirNames (no default exclusions)", () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-config-"));
    const cfg = resolveCodemapConfig(root, { excludeDirNames: [] });
    expect([...cfg.excludeDirNames]).toEqual([]);
    expect(cfg.excludeDirNames).not.toEqual(DEFAULT_EXCLUDE_DIR_NAMES);
  });
});
