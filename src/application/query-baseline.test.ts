import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb, upsertQueryBaseline } from "../db";
import { initCodemap } from "../runtime";
import {
  baselineQueryIncompatibility,
  compareQueryBaseline,
} from "./query-baseline";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "query-baseline-"));
  initCodemap(resolveCodemapConfig(projectRoot, undefined));
  const db = openDb();
  try {
    createTables(db);
    db.run(
      "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/a.ts', 'h1', 10, 1, 'typescript', 1, 1)",
    );
    db.run(
      "INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export, members, doc_comment, value, parent_name, visibility, complexity) VALUES ('src/a.ts', 'foo', 'function', 1, 1, 'foo()', 1, 0, NULL, NULL, NULL, NULL, NULL, 1)",
    );
    upsertQueryBaseline(db, {
      name: "symbols",
      recipe_id: null,
      sql: "SELECT name FROM symbols ORDER BY name",
      rows_json: JSON.stringify([{ name: "bar" }]),
      row_count: 1,
      git_ref: null,
      created_at: 1,
    });
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("compareQueryBaseline", () => {
  it("returns full diff with added and removed rows", () => {
    const payload = compareQueryBaseline({
      baselineName: "symbols",
      sql: "SELECT name FROM symbols ORDER BY name",
    });
    expect("error" in payload).toBe(false);
    if ("error" in payload) return;
    expect(payload.baseline.name).toBe("symbols");
    expect(payload.current_row_count).toBe(1);
    expect(payload.added).toEqual([{ name: "foo" }]);
    expect(payload.removed).toEqual([{ name: "bar" }]);
  });

  it("summary mode returns counts only", () => {
    const payload = compareQueryBaseline({
      baselineName: "symbols",
      sql: "SELECT name FROM symbols ORDER BY name",
      summary: true,
    });
    expect("error" in payload).toBe(false);
    if ("error" in payload) return;
    expect(payload.added).toBe(1);
    expect(payload.removed).toBe(1);
  });

  it("errors on missing baseline", () => {
    const payload = compareQueryBaseline({
      baselineName: "missing",
      sql: "SELECT 1",
    });
    expect(payload).toMatchObject({
      error: expect.stringContaining('no baseline named "missing"'),
    });
  });

  it("attaches recipe actions on added rows only", () => {
    const actions = [{ type: "inspect", description: "review" }];
    const payload = compareQueryBaseline({
      baselineName: "symbols",
      sql: "SELECT name FROM symbols ORDER BY name",
      recipeActions: actions,
    });
    expect("error" in payload).toBe(false);
    if ("error" in payload) return;
    if (!Array.isArray(payload.added) || !Array.isArray(payload.removed))
      return;
    expect(payload.added[0]).toMatchObject({
      name: "foo",
      actions,
    });
    expect(payload.removed[0]).not.toHaveProperty("actions");
  });
});

describe("baselineQueryIncompatibility", () => {
  it("allows baseline with json format", () => {
    expect(
      baselineQueryIncompatibility({ baseline: "x", format: "json" }),
    ).toBeUndefined();
  });

  it("rejects baseline + sarif", () => {
    expect(
      baselineQueryIncompatibility({ baseline: "x", format: "sarif" }),
    ).toMatch(/cannot be combined with format=sarif/);
  });

  it("rejects baseline + group_by", () => {
    expect(
      baselineQueryIncompatibility({ baseline: "x", group_by: "file_path" }),
    ).toMatch(/cannot be combined with group_by/);
  });
});
