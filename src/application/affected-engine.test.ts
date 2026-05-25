import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import {
  CHANGED_PATH_DELIM,
  executeAffectedTests,
  joinChangedPaths,
  normalizeChangedPathList,
  resolveAffectedChangedPaths,
} from "./affected-engine";

let benchDir: string;
let gitRoot: string | undefined;

function fixtureEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_") || k.startsWith("HUSKY")) continue;
    e[k] = v;
  }
  e.GIT_AUTHOR_DATE = "2026-01-01T00:00:00Z";
  e.GIT_COMMITTER_DATE = "2026-01-01T00:00:00Z";
  return e;
}

function git(args: string[], root: string): string {
  const r = spawnSync("git", args, { cwd: root, env: fixtureEnv() });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  }
  return r.stdout.toString().trim();
}

function seedAffectedGraph(db: ReturnType<typeof openDb>): void {
  db.run(
    `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
     VALUES
       ('src/lib/util.ts', 'h1', 10, 1, 'typescript', 1, 1),
       ('src/__tests__/util.test.ts', 'h2', 10, 1, 'typescript', 1, 1),
       ('src/other.spec.ts', 'h3', 10, 1, 'typescript', 1, 1)`,
  );
  db.run(
    `INSERT INTO dependencies (from_path, to_path)
     VALUES ('src/__tests__/util.test.ts', 'src/lib/util.ts')`,
  );
  db.run(
    `INSERT INTO test_suites (file_path, name, kind, line_start, line_end, framework)
     VALUES ('src/__tests__/util.test.ts', 'util', 'describe', 1, 10, 'bun-test')`,
  );
}

beforeEach(() => {
  benchDir = mkdtempSync(join(tmpdir(), "affected-engine-"));
  mkdirSync(join(benchDir, "src"), { recursive: true });
  writeFileSync(join(benchDir, "package.json"), "{}\n");
  initCodemap(resolveCodemapConfig(benchDir, undefined));
  const db = openDb();
  try {
    createTables(db);
    seedAffectedGraph(db);
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(benchDir, { recursive: true, force: true });
  if (gitRoot !== undefined) {
    rmSync(gitRoot, { recursive: true, force: true });
    gitRoot = undefined;
  }
});

describe("normalizeChangedPathList / joinChangedPaths", () => {
  it("joins unique trimmed paths with RS delimiter", () => {
    expect(
      joinChangedPaths([
        "src/a.ts",
        "./src/b.ts",
        "src/a.ts",
        "",
        "  src/c.ts  ",
      ]),
    ).toBe(["src/a.ts", "src/b.ts", "src/c.ts"].join(CHANGED_PATH_DELIM));
  });

  it("normalizeChangedPathList dedupes while preserving order", () => {
    expect(
      normalizeChangedPathList(["./src/a.ts", "src/a.ts", "src/b.ts"]),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("resolveAffectedChangedPaths", () => {
  it("returns explicit paths when provided", () => {
    expect(
      resolveAffectedChangedPaths({
        root: benchDir,
        paths: ["./src/foo.ts", "src/foo.ts"],
      }),
    ).toEqual({ ok: true, paths: ["src/foo.ts"] });
  });

  it("returns empty array for explicit empty paths", () => {
    expect(resolveAffectedChangedPaths({ root: benchDir, paths: [] })).toEqual({
      ok: true,
      paths: [],
    });
  });

  it("uses changed_since agent error labels", () => {
    const r = resolveAffectedChangedPaths({
      root: benchDir,
      changedSince: "not-a-real-ref-xyz",
      errorStyle: "agent",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("changed_since");
      expect(r.error).not.toContain("--changed-since");
    }
  });

  describe("temp git repo", () => {
    beforeEach(() => {
      gitRoot = mkdtempSync(join(tmpdir(), "affected-engine-git-"));
      git(["init", "-q", "-b", "main", "--template="], gitRoot);
      git(["config", "user.email", "t@example.com"], gitRoot);
      git(["config", "user.name", "T"], gitRoot);
      git(["config", "commit.gpgsign", "false"], gitRoot);
      mkdirSync(join(gitRoot, "src"), { recursive: true });
      writeFileSync(join(gitRoot, "src", "util.ts"), "export const x = 1;\n");
      git(["add", "."], gitRoot);
      git(["commit", "-m", "base", "--no-gpg-sign"], gitRoot);
    });

    it("discovers working-tree changes when paths omitted", () => {
      if (gitRoot === undefined) {
        throw new Error("gitRoot not initialised");
      }
      writeFileSync(join(gitRoot, "src", "util.ts"), "export const x = 2;\n");
      const r = resolveAffectedChangedPaths({ root: gitRoot });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.paths).toContain("src/util.ts");
    });
  });
});

describe("executeAffectedTests", () => {
  it("returns transitive test file for a changed source path", () => {
    const result = executeAffectedTests({
      root: benchDir,
      changedPaths: ["src/lib/util.ts"],
    });
    expect(result).toEqual({
      ok: true,
      rows: [
        {
          test_path: "src/__tests__/util.test.ts",
          impact_depth: 1,
          actions: [
            {
              type: "run-affected-tests",
              description:
                "Test file paths only — CI composes the exit policy and runner command.",
            },
          ],
        },
      ],
    });
  });

  it("returns empty rows when no changed paths", () => {
    expect(executeAffectedTests({ root: benchDir, changedPaths: [] })).toEqual({
      ok: true,
      rows: [],
    });
  });

  it("respects max_depth=0 (no transitive expansion)", () => {
    const result = executeAffectedTests({
      root: benchDir,
      changedPaths: ["src/lib/util.ts"],
      maxDepth: 0,
    });
    expect(result).toEqual({ ok: true, rows: [] });
  });

  it("respects test_glob filter", () => {
    const result = executeAffectedTests({
      root: benchDir,
      changedPaths: ["src/other.spec.ts"],
      testGlob: "src/other.spec.ts",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rows).toEqual([
        expect.objectContaining({
          test_path: "src/other.spec.ts",
          impact_depth: 0,
        }),
      ]);
    }
  });
});
