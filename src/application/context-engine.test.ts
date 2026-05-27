import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import {
  closeDb,
  createTables,
  insertDependencies,
  insertFile,
  insertSymbols,
  openDb,
  setMeta,
} from "../db";
import type { DependencyRow, SymbolRow } from "../db";
import { initCodemap } from "../runtime";
import {
  buildContextEnvelope,
  classifyIntent,
  composeStartHere,
  defaultStartHereClassification,
  resolveContextBudget,
} from "./context-engine";
import * as indexEngine from "./index-engine";

let benchDir: string;

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "context-engine-"));
  mkdirSync(join(benchDir, ".codemap"), { recursive: true });
  mkdirSync(join(benchDir, "src"), { recursive: true });
  writeFileSync(
    join(benchDir, "src", "hub.ts"),
    "export function hubFn(x: number): string {\n  return String(x);\n}\nexport class HubClass {}\n",
  );
  initCodemap(resolveCodemapConfig(benchDir, undefined));
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
});

function withSeededDb<T>(fn: (db: ReturnType<typeof openDb>) => T): T {
  const db = openDb();
  try {
    createTables(db);
    seedContextFixture(db);
    return fn(db);
  } finally {
    closeDb(db);
  }
}

function seedContextFixture(db: ReturnType<typeof openDb>): void {
  insertFile(db, {
    path: "src/hub.ts",
    content_hash: "h1",
    size: 100,
    line_count: 20,
    language: "typescript",
    last_modified: 1,
    indexed_at: 1,
  });
  insertFile(db, {
    path: "src/leaf.ts",
    content_hash: "h2",
    size: 50,
    line_count: 10,
    language: "typescript",
    last_modified: 1,
    indexed_at: 1,
  });
  insertFile(db, {
    path: "src/other.ts",
    content_hash: "h3",
    size: 50,
    line_count: 10,
    language: "typescript",
    last_modified: 1,
    indexed_at: 1,
  });

  const hubSymbols: SymbolRow[] = [
    {
      file_path: "src/hub.ts",
      name: "hubFn",
      kind: "function",
      line_start: 1,
      line_end: 5,
      signature: "export function hubFn(x: number): string",
      is_exported: 1,
      is_default_export: 0,
      members: null,
      doc_comment: null,
      value: null,
      parent_name: null,
      visibility: null,
      complexity: null,
      name_column_start: 0,
      name_column_end: 0,
      scope_local_id: 0,
      body_line_count: null,
      param_count: null,
      nesting_depth: null,
      return_type: null,
      is_async: 0,
      is_generator: 0,
    },
    {
      file_path: "src/hub.ts",
      name: "HubClass",
      kind: "class",
      line_start: 7,
      line_end: 12,
      signature: "export class HubClass",
      is_exported: 1,
      is_default_export: 0,
      members: null,
      doc_comment: null,
      value: null,
      parent_name: null,
      visibility: null,
      complexity: null,
      name_column_start: 0,
      name_column_end: 0,
      scope_local_id: 0,
      body_line_count: null,
      param_count: null,
      nesting_depth: null,
      return_type: null,
      is_async: 0,
      is_generator: 0,
    },
  ];
  insertSymbols(db, hubSymbols);

  const deps: DependencyRow[] = [
    { from_path: "src/leaf.ts", to_path: "src/hub.ts" },
    { from_path: "src/other.ts", to_path: "src/hub.ts" },
    { from_path: "src/other.ts", to_path: "src/leaf.ts" },
  ];
  insertDependencies(db, deps);

  db.run(
    "INSERT INTO markers (file_path, line_number, kind, content) VALUES ('src/leaf.ts', 3, 'TODO', 'wire tests'), ('src/leaf.ts', 8, 'NOTE', 'later'), ('src/other.ts', 2, 'FIXME', 'crash here')",
  );
}

function composeOpts(): { fileCount: number; projectRoot: string } {
  return { fileCount: 3, projectRoot: benchDir };
}

describe("resolveContextBudget", () => {
  it("uses full caps on small repos", () => {
    expect(resolveContextBudget(100).hub_limit).toBe(5);
    expect(resolveContextBudget(100).signatures_per_hub).toBe(3);
  });

  it("tightens caps on large repos", () => {
    expect(resolveContextBudget(6000).hub_limit).toBe(2);
    expect(resolveContextBudget(6000).signature_max_chars).toBe(60);
  });
});

describe("composeStartHere", () => {
  it("includes intent-ranked recipe cards and hub leaders with signatures", () => {
    withSeededDb((db) => {
      const start = composeStartHere(
        db,
        classifyIntent("refactor auth"),
        composeOpts(),
      );
      expect(start.classified_as).toBe("refactor");
      expect(start.recipes.map((r) => r.id)).toEqual([
        "fan-in",
        "fan-out",
        "barrel-files",
        "deprecated-symbols",
      ]);
      expect(start.index_summary.files).toBe(3);
      expect(start.recipes[0]?.tool).toBe("query_recipe");
      expect(start.hub_leaders[0]).toMatchObject({
        file_path: "src/hub.ts",
        fan_in: 2,
      });
      expect(start.hub_leaders[0]?.signatures[0]).toMatchObject({
        name: "hubFn",
        kind: "function",
      });
    });
  });

  it("uses explore defaults when no intent is supplied at envelope build time", () => {
    withSeededDb((db) => {
      const start = composeStartHere(
        db,
        defaultStartHereClassification(),
        composeOpts(),
      );
      expect(start.classified_as).toBe("explore");
      expect(start.recipes.map((r) => r.id)).toContain("index-summary");
      expect(start.recipes.map((r) => r.id)).toContain("fan-in");
    });
  });

  it("adds one-line snippets when includeSnippets is true", () => {
    withSeededDb((db) => {
      const start = composeStartHere(db, defaultStartHereClassification(), {
        ...composeOpts(),
        includeSnippets: true,
      });
      const hubFn = start.hub_leaders[0]?.signatures.find(
        (s) => s.name === "hubFn",
      );
      expect(hubFn?.snippet).toContain("export function hubFn");
    });
  });

  it("respects adaptive hub limits for large file counts", () => {
    withSeededDb((db) => {
      const start = composeStartHere(db, defaultStartHereClassification(), {
        fileCount: 6000,
        projectRoot: benchDir,
      });
      expect(start.hub_leaders.length).toBeLessThanOrEqual(2);
      expect(start.hub_leaders[0]?.signatures.length).toBeLessThanOrEqual(1);
    });
  });
});

describe("buildContextEnvelope", () => {
  it("includes start_here in non-compact mode", () => {
    const head = "cccccccccccccccccccccccccccccccccccccccc";
    const revParse = spyOn(indexEngine, "getCurrentCommit").mockReturnValue(
      head,
    );
    const changedFiles = spyOn(indexEngine, "getChangedFiles").mockReturnValue({
      changed: [],
      deleted: [],
      existingPaths: new Set(),
      sourceCache: new Map(),
      existingHashes: new Map(),
    });

    try {
      withSeededDb((db) => {
        setMeta(db, "last_indexed_commit", head);
        const envelope = buildContextEnvelope(db, benchDir, {
          compact: false,
          intent: null,
        });
        expect(envelope.start_here?.classified_as).toBe("explore");
        expect(envelope.start_here?.index_summary.files).toBe(3);
        expect(envelope.start_here?.hub_leaders.length).toBeGreaterThan(0);
        expect(envelope.hubs?.[0]?.to_path).toBe("src/hub.ts");
        expect(envelope.intent).toBeUndefined();
      });
    } finally {
      revParse.mockRestore();
      changedFiles.mockRestore();
    }
  });

  it("biases sample_markers toward FIXME/TODO when debug intent is set", () => {
    const revParse = spyOn(indexEngine, "getCurrentCommit").mockReturnValue("");
    try {
      withSeededDb((db) => {
        const envelope = buildContextEnvelope(db, benchDir, {
          compact: false,
          intent: "fix this crash",
        });
        expect(envelope.intent?.classified_as).toBe("debug");
        expect(envelope.sample_markers?.[0]?.kind).toBe("FIXME");
      });
    } finally {
      revParse.mockRestore();
    }
  });

  it("omits start_here when compact", () => {
    const revParse = spyOn(indexEngine, "getCurrentCommit").mockReturnValue("");
    try {
      withSeededDb((db) => {
        const envelope = buildContextEnvelope(db, benchDir, {
          compact: true,
          intent: "fix crash",
        });
        expect(envelope.start_here).toBeUndefined();
        expect(envelope.hubs).toBeUndefined();
        expect(envelope.intent?.classified_as).toBe("debug");
      });
    } finally {
      revParse.mockRestore();
    }
  });

  it("truncates long signatures in hub_leaders", () => {
    withSeededDb((db) => {
      const longSig = `export function wide(${Array.from({ length: 40 }, (_, i) => `arg${i}: number`).join(", ")}): void`;
      insertSymbols(db, [
        {
          file_path: "src/hub.ts",
          name: "wideFn",
          kind: "function",
          line_start: 20,
          line_end: 25,
          signature: longSig,
          is_exported: 1,
          is_default_export: 0,
          members: null,
          doc_comment: null,
          value: null,
          parent_name: null,
          visibility: null,
          complexity: null,
          name_column_start: 0,
          name_column_end: 0,
          scope_local_id: 0,
          body_line_count: null,
          param_count: null,
          nesting_depth: null,
          return_type: null,
          is_async: 0,
          is_generator: 0,
        },
      ]);

      const start = composeStartHere(
        db,
        defaultStartHereClassification(),
        composeOpts(),
      );
      const wide = start.hub_leaders[0]?.signatures.find(
        (s) => s.name === "wideFn",
      );
      expect(wide?.signature.endsWith("…")).toBe(true);
      expect(wide!.signature.length).toBeLessThanOrEqual(120);
    });
  });
});
