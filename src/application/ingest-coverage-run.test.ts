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
});
