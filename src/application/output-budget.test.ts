import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, insertFile, openDb } from "../db";
import { initCodemap } from "../runtime";
import {
  applySourceCharBudget,
  DEFAULT_EXPLORE_ROW_LIMIT,
  DEFAULT_OUTPUT_CHAR_BUDGET,
  readIndexedFileCount,
  resolveEffectiveExploreRowLimit,
  resolveEffectiveSnippetBudget,
  resolveOutputBudget,
} from "./output-budget";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "output-budget-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  initCodemap(resolveCodemapConfig(benchDir, undefined));
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
});

function seedFileCount(count: number): ReturnType<typeof openDb> {
  const db = openDb();
  createTables(db);
  for (let i = 0; i < count; i++) {
    insertFile(db, {
      path: `src/f${i}.ts`,
      content_hash: `h${i}`,
      size: 1,
      line_count: 1,
      language: "typescript",
      last_modified: 1,
      indexed_at: 1,
    });
  }
  return db;
}

describe("resolveOutputBudget", () => {
  it("uses full caps on small repos", () => {
    expect(resolveOutputBudget(100)).toEqual({
      snippet_char_budget: DEFAULT_OUTPUT_CHAR_BUDGET,
      explore_row_limit: DEFAULT_EXPLORE_ROW_LIMIT,
    });
    expect(resolveOutputBudget(500).snippet_char_budget).toBe(15_000);
  });

  it("tightens caps on mid-size repos", () => {
    expect(resolveOutputBudget(501)).toEqual({
      snippet_char_budget: 10_000,
      explore_row_limit: 250,
    });
    expect(resolveOutputBudget(5000).explore_row_limit).toBe(250);
  });

  it("tightens caps on large repos", () => {
    expect(resolveOutputBudget(6000)).toEqual({
      snippet_char_budget: 6_000,
      explore_row_limit: 125,
    });
  });
});

describe("resolveEffectiveSnippetBudget", () => {
  it("honors explicit budget_chars", () => {
    const db = seedFileCount(6000);
    try {
      expect(resolveEffectiveSnippetBudget(db, 42)).toBe(42);
    } finally {
      closeDb(db);
    }
  });

  it("derives adaptive cap from indexed file count", () => {
    const smallDir = mkdtempSync(join(tmpdir(), "output-budget-small-"));
    const largeDir = mkdtempSync(join(tmpdir(), "output-budget-large-"));
    mkdirSync(join(smallDir, "src"), { recursive: true });
    mkdirSync(join(largeDir, "src"), { recursive: true });
    initCodemap(resolveCodemapConfig(smallDir, undefined));
    const small = seedFileCount(3);
    const smallBudget = resolveEffectiveSnippetBudget(small);
    closeDb(small);

    initCodemap(resolveCodemapConfig(largeDir, undefined));
    const large = seedFileCount(6000);
    try {
      expect(smallBudget).toBe(15_000);
      expect(resolveEffectiveSnippetBudget(large)).toBe(6_000);
      expect(readIndexedFileCount(large)).toBe(6000);
    } finally {
      closeDb(large);
      rmSync(smallDir, { recursive: true, force: true });
      rmSync(largeDir, { recursive: true, force: true });
    }
  });
});

describe("resolveEffectiveExploreRowLimit", () => {
  it("honors explicit rowLimit", () => {
    const db = seedFileCount(6000);
    try {
      expect(resolveEffectiveExploreRowLimit(db, 7)).toBe(7);
    } finally {
      closeDb(db);
    }
  });

  it("derives adaptive cap from indexed file count", () => {
    const mid = seedFileCount(501);
    try {
      expect(resolveEffectiveExploreRowLimit(mid)).toBe(250);
    } finally {
      closeDb(mid);
    }
  });
});

describe("applySourceCharBudget", () => {
  it("returns all items when under budget", () => {
    const items = [{ source: "abc" }, { source: "de" }];
    expect(applySourceCharBudget(items, 10)).toEqual({
      items,
      truncated: false,
    });
  });

  it("truncates when cumulative source exceeds budget", () => {
    const items = [{ source: "aaaa" }, { source: "bbbb" }, { source: "c" }];
    const r = applySourceCharBudget(items, 6);
    expect(r.items).toEqual([{ source: "aaaa" }]);
    expect(r.truncated).toBe(true);
  });

  it("defaults budget constant is 15k", () => {
    expect(DEFAULT_OUTPUT_CHAR_BUDGET).toBe(15_000);
  });
});
