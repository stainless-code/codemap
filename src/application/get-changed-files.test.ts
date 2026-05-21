import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, getMeta, openDb, setMeta } from "../db";
import { initCodemap } from "../runtime";
import { getChangedFiles } from "./index-engine";

let projectRoot: string;

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

function git(args: string[]): string {
  const r = spawnSync("git", args, { cwd: projectRoot, env: fixtureEnv() });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  }
  return r.stdout.toString().trim();
}

function commitAll(message: string): string {
  git(["add", "."]);
  git(["commit", "-m", message, "--no-gpg-sign"]);
  return git(["rev-parse", "HEAD"]);
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "codemap-git-inc-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "T"]);
  git(["config", "commit.gpgsign", "false"]);
  initCodemap(resolveCodemapConfig(projectRoot, undefined));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("getChangedFiles", () => {
  it("treats committed renames as delete old path + change new path", () => {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src/a.ts"), "export const a = 1;\n");
    const base = commitAll("add a");

    git(["mv", "src/a.ts", "src/b.ts"]);
    commitAll("rename a to b");

    const db = openDb();
    try {
      createTables(db);
      db.run(
        "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/a.ts', 'old', 1, 1, 'typescript', 1, 1)",
      );
      setMeta(db, "last_indexed_commit", base);

      const delta = getChangedFiles(db);
      expect(delta).not.toBeNull();
      expect(delta!.deleted).toContain("src/a.ts");
      expect(delta!.changed).toContain("src/b.ts");
      expect(getMeta(db, "last_indexed_commit")).toBe(base);
    } finally {
      closeDb(db);
    }
  });

  it("indexes modified files whose paths contain spaces (porcelain -z)", () => {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(
      join(projectRoot, "src/my module.ts"),
      "export const x = 1;\n",
    );
    const base = commitAll("add spaced file");

    writeFileSync(
      join(projectRoot, "src/my module.ts"),
      "export const x = 2;\n",
    );

    const db = openDb();
    try {
      createTables(db);
      db.run(
        "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/my module.ts', 'old', 1, 1, 'typescript', 1, 1)",
      );
      setMeta(db, "last_indexed_commit", base);

      const delta = getChangedFiles(db);
      expect(delta).not.toBeNull();
      expect(delta!.changed).toContain("src/my module.ts");
      expect(delta!.deleted).not.toContain("src/my module.ts");
    } finally {
      closeDb(db);
    }
  });
});
