import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { installCodemapTestTeardown } from "../test-helpers/runtime-reset";

installCodemapTestTeardown();

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb, upsertQueryBaseline } from "../db";
import { initCodemap } from "../runtime";
import {
  baselineQueryIncompatibility,
  compareQueryBaseline,
} from "./query-baseline";
import { attachActions } from "./query-engine";

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

  it("errors on corrupt rows_json", () => {
    const db = openDb();
    try {
      upsertQueryBaseline(db, {
        name: "bad-json",
        recipe_id: null,
        sql: "SELECT 1",
        rows_json: "not-json",
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });
    } finally {
      closeDb(db);
    }
    const payload = compareQueryBaseline({
      baselineName: "bad-json",
      sql: "SELECT 1",
    });
    expect(payload).toMatchObject({
      error: expect.stringContaining("corrupt rows_json"),
    });
  });

  it("errors on non-array rows_json", () => {
    const db = openDb();
    try {
      upsertQueryBaseline(db, {
        name: "object-json",
        recipe_id: null,
        sql: "SELECT 1",
        rows_json: "{}",
        row_count: 0,
        git_ref: null,
        created_at: 1,
      });
    } finally {
      closeDb(db);
    }
    const payload = compareQueryBaseline({
      baselineName: "object-json",
      sql: "SELECT 1",
    });
    expect(payload).toMatchObject({
      error: expect.stringContaining("corrupt rows_json"),
    });
  });

  it("errors on invalid SQL", () => {
    const payload = compareQueryBaseline({
      baselineName: "symbols",
      sql: "SELECT FROM bad",
    });
    expect("error" in payload).toBe(true);
    if (!("error" in payload)) return;
    expect(payload.error.length).toBeGreaterThan(0);
  });

  it("filters current rows by changedFiles", () => {
    const payload = compareQueryBaseline({
      baselineName: "symbols",
      sql: "SELECT file_path, name FROM symbols ORDER BY name",
      changedFiles: new Set(["src/other.ts"]),
    });
    expect("error" in payload).toBe(false);
    if ("error" in payload) return;
    expect(payload.current_row_count).toBe(0);
    expect(payload.added).toEqual([]);
    expect(payload.removed).toEqual([{ name: "bar" }]);
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

describe("attachActions", () => {
  it("preserves existing actions on a row", () => {
    const row = { name: "foo", actions: [{ type: "keep" }] };
    expect(attachActions(row, [{ type: "replace" }])).toEqual(row);
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
