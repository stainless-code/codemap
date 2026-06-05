import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import {
  closeDb,
  createIndexes,
  createTables,
  insertFile,
  insertSymbols,
} from "../db";
import { initCodemap } from "../runtime";
import { openCodemapDatabase } from "../sqlite-db";
import {
  resolveCoverageArtifact,
  resolveV8CoverageDirectory,
  runIngestCoverageOnDb,
} from "./ingest-coverage-run";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "ingest-coverage-run-"));
  initCodemap(resolveCodemapConfig(projectRoot, undefined));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("resolveCoverageArtifact", () => {
  it("resolves istanbul file by extension", () => {
    const file = join(projectRoot, "coverage-final.json");
    writeFileSync(file, "{}");
    expect(resolveCoverageArtifact(file, projectRoot)).toEqual({
      format: "istanbul",
      absPath: file,
    });
  });

  it("errors when directory holds both istanbul and lcov", () => {
    const dir = join(projectRoot, "coverage");
    mkdirSync(dir);
    writeFileSync(join(dir, "coverage-final.json"), "{}");
    writeFileSync(join(dir, "lcov.info"), "TN:\n");
    expect(() => resolveCoverageArtifact(dir, projectRoot)).toThrow(
      /both coverage-final\.json and lcov\.info/,
    );
  });

  it("errors when path not found", () => {
    expect(() =>
      resolveCoverageArtifact("missing/coverage-final.json", projectRoot),
    ).toThrow(/path not found/);
  });

  it("resolves lcov file by extension", () => {
    const file = join(projectRoot, "lcov.info");
    writeFileSync(file, "TN:\n");
    expect(resolveCoverageArtifact(file, projectRoot)).toEqual({
      format: "lcov",
      absPath: file,
    });
  });

  it("resolves directory with lcov only", () => {
    const dir = join(projectRoot, "cov");
    mkdirSync(dir);
    writeFileSync(join(dir, "lcov.info"), "TN:\n");
    expect(resolveCoverageArtifact(dir, projectRoot)).toEqual({
      format: "lcov",
      absPath: join(dir, "lcov.info"),
    });
  });

  it("errors when directory has neither artifact", () => {
    const dir = join(projectRoot, "empty");
    mkdirSync(dir);
    expect(() => resolveCoverageArtifact(dir, projectRoot)).toThrow(
      /contains neither/,
    );
  });
});

describe("resolveV8CoverageDirectory", () => {
  it("errors when path not found", () => {
    expect(() =>
      resolveV8CoverageDirectory("missing-dir", projectRoot),
    ).toThrow(/path not found/);
  });

  it("errors when path is a file", () => {
    const file = join(projectRoot, "coverage-1.json");
    writeFileSync(file, "{}");
    expect(() => resolveV8CoverageDirectory(file, projectRoot)).toThrow(
      /expected a directory/,
    );
  });

  it("errors when directory has no coverage-*.json files", () => {
    const dir = join(projectRoot, "v8-empty");
    mkdirSync(dir);
    expect(() => resolveV8CoverageDirectory(dir, projectRoot)).toThrow(
      /no coverage-\*\.json/,
    );
  });

  it("returns json files from a v8 directory", () => {
    const dir = join(projectRoot, "v8");
    mkdirSync(dir);
    const file = join(dir, "coverage-123.json");
    writeFileSync(file, "{}");
    expect(resolveV8CoverageDirectory(dir, projectRoot)).toEqual({
      absDir: dir,
      jsonFiles: [file],
    });
  });
});

describe("runIngestCoverageOnDb", () => {
  it("ingests istanbul artifact into coverage table", async () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      createIndexes(db);
      insertFile(db, {
        path: "src/lib/cache.ts",
        content_hash: "h1",
        size: 1,
        line_count: 100,
        language: "typescript",
        last_modified: 0,
        indexed_at: 0,
      });
      insertSymbols(db, [
        {
          file_path: "src/lib/cache.ts",
          name: "get",
          kind: "function",
          line_start: 9,
          line_end: 15,
          signature: "get(): void",
          is_exported: 1,
          is_default_export: 0,
          members: null,
          doc_comment: null,
          value: null,
          parent_name: null,
          visibility: null,
        },
      ]);

      const coverageDir = join(projectRoot, "coverage");
      mkdirSync(coverageDir);
      const artifact = join(coverageDir, "coverage-final.json");
      writeFileSync(
        artifact,
        JSON.stringify({
          [`${projectRoot}/src/lib/cache.ts`]: {
            path: `${projectRoot}/src/lib/cache.ts`,
            statementMap: {
              "0": {
                start: { line: 10, column: 0 },
                end: { line: 10, column: 1 },
              },
            },
            s: { "0": 1 },
          },
        }),
      );

      const outcome = await runIngestCoverageOnDb(db, {
        projectRoot,
        path: "coverage/coverage-final.json",
      });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.result.format).toBe("istanbul");
      expect(outcome.result.ingested.symbols).toBe(1);

      const rows = db.query("SELECT name FROM coverage").all() as Array<{
        name: string;
      }>;
      expect(rows.map((r) => r.name)).toEqual(["get"]);
    } finally {
      closeDb(db);
    }
  });

  it("returns ok:false when runtime json files have empty result", async () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      const dir = join(projectRoot, "v8-runtime");
      mkdirSync(dir);
      writeFileSync(
        join(dir, "coverage-1.json"),
        JSON.stringify({ result: [] }),
      );

      const outcome = await runIngestCoverageOnDb(db, {
        projectRoot,
        path: "v8-runtime",
        runtime: true,
      });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error).toMatch(/contained no V8/);
    } finally {
      closeDb(db);
    }
  });
});
