import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import {
  closeDb,
  createSchema,
  getMeta,
  insertFile,
  META_CHURN_CONFIG_FINGERPRINT,
  META_CHURN_INDEXED_COMMIT,
  setMeta,
} from "../db";
import { initCodemap } from "../runtime";
import { openCodemapDatabase } from "../sqlite-db";
import {
  computeChurnTrend,
  ingestFileChurnFromGit,
  refreshFileChurn,
} from "./churn-ingest";

let projectRoot: string;

function fixtureEnv(dates: {
  author: string;
  committer: string;
}): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith("GIT_") || k.startsWith("HUSKY")) continue;
    e[k] = v;
  }
  e.GIT_AUTHOR_DATE = dates.author;
  e.GIT_COMMITTER_DATE = dates.committer;
  return e;
}

function git(args: string[], env?: NodeJS.ProcessEnv): void {
  const r = spawnSync("git", args, {
    cwd: projectRoot,
    env:
      env ??
      fixtureEnv({
        author: "2026-06-01T12:00:00Z",
        committer: "2026-06-01T12:00:00Z",
      }),
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")}: ${r.stderr.toString().trim()}`);
  }
}

function commitAll(message: string, env?: NodeJS.ProcessEnv): void {
  git(["add", "."], env);
  git(["commit", "-m", message, "--no-gpg-sign"], env);
}

describe("computeChurnTrend", () => {
  it("returns null when commit_count is below threshold", () => {
    expect(
      computeChurnTrend({
        commit_count: 3,
        recent_weighted: 2,
        older_weighted: 1,
      }),
    ).toBeNull();
  });

  it("classifies accelerating when recent mass dominates", () => {
    expect(
      computeChurnTrend({
        commit_count: 8,
        recent_weighted: 7,
        older_weighted: 2,
      }),
    ).toBe("accelerating");
  });

  it("classifies cooling when older mass dominates", () => {
    expect(
      computeChurnTrend({
        commit_count: 10,
        recent_weighted: 1,
        older_weighted: 9,
      }),
    ).toBe("cooling");
  });

  it("classifies stable when recent and older mass are balanced", () => {
    expect(
      computeChurnTrend({
        commit_count: 8,
        recent_weighted: 5,
        older_weighted: 5,
      }),
    ).toBe("stable");
  });
});

describe("ingestFileChurnFromGit", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "codemap-churn-"));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "T"]);
    git(["config", "commit.gpgsign", "false"]);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("populates file_churn for indexed paths from git history", () => {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src/hot.ts"), "export const a = 1;\n");
    commitAll("add hot");
    writeFileSync(join(projectRoot, "src/hot.ts"), "export const a = 2;\n");
    commitAll("edit hot");

    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/hot.ts",
        content_hash: "h",
        size: 10,
        line_count: 1,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });

      const result = ingestFileChurnFromGit(db, {
        projectRoot,
        quiet: true,
      });
      expect(result.ok).toBe(true);
      expect(result.rowCount).toBe(1);
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

      const row = db
        .query<{
          file_path: string;
          commit_count: number;
          weighted_commits: number;
        }>(
          "SELECT file_path, commit_count, weighted_commits FROM file_churn WHERE file_path = ?",
        )
        .get("src/hot.ts");
      expect(row?.commit_count).toBe(2);
      expect(row?.weighted_commits).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });

  it("respects since ref (only commits after anchor)", () => {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src/a.ts"), "v1\n");
    commitAll(
      "old",
      fixtureEnv({
        author: "2024-01-01T12:00:00Z",
        committer: "2024-01-01T12:00:00Z",
      }),
    );
    const anchor = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf-8",
    })
      .stdout.toString()
      .trim();
    writeFileSync(join(projectRoot, "src/a.ts"), "v2\n");
    commitAll(
      "new",
      fixtureEnv({
        author: "2026-06-01T12:00:00Z",
        committer: "2026-06-01T12:00:00Z",
      }),
    );

    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "a",
        size: 10,
        line_count: 1,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      const result = ingestFileChurnFromGit(db, {
        projectRoot,
        since: anchor,
        quiet: true,
      });
      expect(result.ok).toBe(true);
      const row = db
        .query<{ commit_count: number }>(
          "SELECT commit_count FROM file_churn WHERE file_path = 'src/a.ts'",
        )
        .get();
      expect(row?.commit_count).toBe(1);
    } finally {
      closeDb(db);
    }
  });

  it("skips gracefully when not a git repository", () => {
    const noGit = mkdtempSync(join(tmpdir(), "codemap-no-git-"));
    try {
      const db = openCodemapDatabase(":memory:");
      try {
        createSchema(db);
        insertFile(db, {
          path: "src/x.ts",
          content_hash: "x",
          size: 1,
          line_count: 1,
          language: "typescript",
          last_modified: 1,
          indexed_at: 1,
        });
        const result = ingestFileChurnFromGit(db, {
          projectRoot: noGit,
          quiet: true,
        });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain("not a git");
        const n = db
          .query<{ c: number }>("SELECT COUNT(*) AS c FROM file_churn")
          .get()?.c;
        expect(n).toBe(0);
      } finally {
        closeDb(db);
      }
    } finally {
      rmSync(noGit, { recursive: true, force: true });
    }
  });
});

describe("refreshFileChurn", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "codemap-churn-refresh-"));
    initCodemap(resolveCodemapConfig(projectRoot, undefined));
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@example.com"]);
    git(["config", "user.name", "T"]);
    git(["config", "commit.gpgsign", "false"]);
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src/a.ts"), "export const a = 1;\n");
    commitAll("seed");
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it("idle skip requires populated file_churn even when HEAD meta matches", () => {
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf-8",
    })
      .stdout.toString()
      .trim();
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "a",
        size: 10,
        line_count: 1,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      setMeta(db, META_CHURN_INDEXED_COMMIT, head);
      setMeta(db, META_CHURN_CONFIG_FINGERPRINT, "90|");

      const result = refreshFileChurn(db, {
        projectRoot,
        mode: "idle",
        halfLifeDays: 90,
        since: null,
        quiet: true,
      });
      expect(result.reason).not.toBe("skipped: HEAD unchanged");
      expect(result.ok).toBe(true);
      expect(result.rowCount).toBeGreaterThan(0);
    } finally {
      closeDb(db);
    }
  });

  it("skips git when config churn.file is set", () => {
    writeFileSync(
      join(projectRoot, "churn.json"),
      JSON.stringify([
        {
          file_path: "src/a.ts",
          commit_count: 99,
          weighted_commits: 88,
          lines_added: 1,
          lines_removed: 0,
          last_commit_at: "2026-06-01T00:00:00Z",
          churn_trend: "stable",
          computed_at: "2026-06-10T00:00:00Z",
        },
      ]),
    );
    initCodemap(
      resolveCodemapConfig(projectRoot, { churn: { file: "churn.json" } }),
    );
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "a",
        size: 10,
        line_count: 1,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      const result = refreshFileChurn(db, {
        projectRoot,
        quiet: true,
      });
      expect(result.ok).toBe(true);
      expect(result.reason).toBe("config churn.file");
      const row = db
        .query<{ commit_count: number }>(
          "SELECT commit_count FROM file_churn WHERE file_path = 'src/a.ts'",
        )
        .get();
      expect(row?.commit_count).toBe(99);
    } finally {
      closeDb(db);
    }
  });

  it("idle skip when HEAD, rows, and config fingerprint match", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "a",
        size: 10,
        line_count: 1,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      ingestFileChurnFromGit(db, { projectRoot, quiet: true });
      const result = refreshFileChurn(db, {
        projectRoot,
        mode: "idle",
        halfLifeDays: 90,
        since: null,
        quiet: true,
      });
      expect(result.reason).toBe("skipped: HEAD unchanged");
      expect(result.elapsedMs).toBeLessThan(50);
    } finally {
      closeDb(db);
    }
  });

  it("incremental scope merges churn for changed paths only", () => {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src/a.ts"), "export const a = 1;\n");
    writeFileSync(join(projectRoot, "src/b.ts"), "export const b = 1;\n");
    commitAll("seed both");
    writeFileSync(join(projectRoot, "src/a.ts"), "export const a = 2;\n");
    commitAll("edit a once");

    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      for (const path of ["src/a.ts", "src/b.ts"]) {
        insertFile(db, {
          path,
          content_hash: path,
          size: 10,
          line_count: 1,
          language: "typescript",
          last_modified: 1,
          indexed_at: 1,
        });
      }
      ingestFileChurnFromGit(db, { projectRoot, quiet: true });
      const bBefore = db
        .query<{ commit_count: number }>(
          "SELECT commit_count FROM file_churn WHERE file_path = 'src/b.ts'",
        )
        .get()?.commit_count;

      writeFileSync(join(projectRoot, "src/a.ts"), "export const a = 3;\n");
      commitAll("edit a again");
      const scoped = ingestFileChurnFromGit(db, {
        projectRoot,
        scopePaths: ["src/a.ts"],
        quiet: true,
      });
      expect(scoped.ok).toBe(true);
      const aAfter = db
        .query<{ commit_count: number }>(
          "SELECT commit_count FROM file_churn WHERE file_path = 'src/a.ts'",
        )
        .get()?.commit_count;
      const bAfter = db
        .query<{ commit_count: number }>(
          "SELECT commit_count FROM file_churn WHERE file_path = 'src/b.ts'",
        )
        .get()?.commit_count;
      expect(aAfter).toBe(3);
      expect(bAfter).toBe(bBefore);
    } finally {
      closeDb(db);
    }
  });

  it("deletions mode stamps meta without running git log", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "a",
        size: 10,
        line_count: 1,
        language: "typescript",
        last_modified: 1,
        indexed_at: 1,
      });
      ingestFileChurnFromGit(db, { projectRoot, quiet: true });
      const result = refreshFileChurn(db, {
        projectRoot,
        mode: "deletions",
        halfLifeDays: 90,
        since: null,
        quiet: true,
      });
      expect(result.reason).toBe("deletions: churn pruned via CASCADE");
      expect(getMeta(db, META_CHURN_INDEXED_COMMIT)).toBeTruthy();
    } finally {
      closeDb(db);
    }
  });
});
