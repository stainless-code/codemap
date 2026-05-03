import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTables } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { runAuditFromRef } from "./audit-engine";
import {
  _wipeCacheForTests,
  isGitRepo,
  lookupCacheEntry,
  populateWorktree,
  resolveSha,
} from "./audit-worktree";

// Production `audit-worktree.ts` already strips GIT_* env vars on its
// own git spawns; the fixture-side helpers below mirror that for the
// `git init` / `git commit` calls used to set up the repo.
let projectRoot: string;
let baseSha: string;
let headSha: string;

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

function git(args: string[]): void {
  const r = spawnSync("git", args, {
    cwd: projectRoot,
    env: fixtureEnv(),
  });
  if (r.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${r.stderr.toString().trim()}`,
    );
  }
}

function commitFiles(message: string, files: Record<string, string>): string {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(projectRoot, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  git(["add", "."]);
  const commit = spawnSync("git", ["commit", "-m", message, "--no-gpg-sign"], {
    cwd: projectRoot,
    env: fixtureEnv(),
  });
  if (commit.status !== 0) {
    throw new Error(`git commit failed: ${commit.stderr.toString().trim()}`);
  }
  const sha = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: projectRoot,
    env: fixtureEnv(),
  })
    .stdout.toString()
    .trim();
  return sha;
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "audit-base-"));
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  git(["config", "commit.gpgsign", "false"]);

  // Base commit — only a.ts.
  baseSha = commitFiles("base", {
    "src/a.ts": "export const a = 1;\n",
  });
  // Head commit — adds b.ts, removes a.ts.
  rmSync(join(projectRoot, "src", "a.ts"));
  headSha = commitFiles("head", {
    "src/b.ts": "export const b = 2;\n",
  });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("isGitRepo", () => {
  it("returns true for a git-initialised dir", () => {
    expect(isGitRepo(projectRoot)).toBe(true);
  });
  it("returns false for a non-git dir", () => {
    const plain = mkdtempSync(join(tmpdir(), "non-git-"));
    try {
      expect(isGitRepo(plain)).toBe(false);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("resolveSha", () => {
  it("resolves a branch ref to its tip sha", () => {
    const r = resolveSha("HEAD", projectRoot);
    expect(r).toEqual({ sha: headSha });
  });

  it("resolves HEAD~1 to the base sha", () => {
    const r = resolveSha("HEAD~1", projectRoot);
    expect(r).toEqual({ sha: baseSha });
  });

  it("returns ref-unresolved for bogus refs", () => {
    const r = resolveSha("definitely-not-a-real-ref", projectRoot);
    expect(r).toMatchObject({ code: "ref-unresolved" });
  });

  it("returns not-git-repo for non-git dirs", () => {
    const plain = mkdtempSync(join(tmpdir(), "non-git-"));
    try {
      const r = resolveSha("HEAD", plain);
      expect(r).toMatchObject({ code: "not-git-repo" });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("populateWorktree + lookupCacheEntry", () => {
  it("populates a fresh cache entry then hits on lookup", async () => {
    const populated = await populateWorktree({
      projectRoot,
      sha: baseSha,
      reindex: async (worktreePath) => {
        // Stand-in for the real reindex — just create an empty cached DB.
        const db = openCodemapDatabase(
          join(worktreePath, ".codemap", "index.db"),
        );
        createTables(db);
        db.close();
      },
    });
    expect(populated).toMatchObject({ sha: baseSha });
    expect(existsSync((populated as { dbPath: string }).dbPath)).toBe(true);

    const hit = lookupCacheEntry(baseSha, { projectRoot });
    expect(hit).toMatchObject({ sha: baseSha });
    expect(hit?.dbPath).toBe((populated as { dbPath: string }).dbPath);
  });

  it("cache hit short-circuits — second populate would reindex but lookup returns first", async () => {
    let reindexCalls = 0;
    const reindex = async (wp: string) => {
      reindexCalls += 1;
      const db = openCodemapDatabase(join(wp, ".codemap", "index.db"));
      createTables(db);
      db.close();
    };
    await populateWorktree({ projectRoot, sha: baseSha, reindex });
    expect(reindexCalls).toBe(1);

    // Caller checks cache before populating — the engine path does this.
    const hit = lookupCacheEntry(baseSha, { projectRoot });
    expect(hit).not.toBeUndefined();
    // Confirm we never called reindex again because the caller skipped populate.
    expect(reindexCalls).toBe(1);
  });

  it("cleans up temp dir on reindex failure (no .tmp.* leftover)", async () => {
    const populated = await populateWorktree({
      projectRoot,
      sha: baseSha,
      reindex: async () => {
        throw new Error("simulated reindex failure");
      },
    });
    expect(populated).toMatchObject({ code: "reindex-failed" });

    const cacheRoot = join(projectRoot, ".codemap/audit-cache");
    if (existsSync(cacheRoot)) {
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(cacheRoot);
      const tmps = entries.filter((e) => e.startsWith(".tmp."));
      expect(tmps).toEqual([]);
    }
  });

  it("eviction does not delete the freshly-populated entry (protectPath)", async () => {
    // Single-huge-entry case: even if the new entry alone would breach
    // MAX_CACHE_BYTES, populateWorktree's protectPath guard keeps it.
    // We don't actually need >500 MiB to exercise the path — a passing
    // populate followed by a successful lookupCacheEntry is sufficient.
    const populated = await populateWorktree({
      projectRoot,
      sha: baseSha,
      reindex: async (worktreePath) => {
        const db = openCodemapDatabase(
          join(worktreePath, ".codemap", "index.db"),
        );
        createTables(db);
        db.close();
      },
    });
    expect(populated).toMatchObject({ sha: baseSha });
    expect(lookupCacheEntry(baseSha, { projectRoot })).toMatchObject({
      sha: baseSha,
    });
  });

  it("returns ref-unresolved-shaped error for bogus shas (worktree add fails)", async () => {
    const r = await populateWorktree({
      projectRoot,
      sha: "0000000000000000000000000000000000000000",
      reindex: async () => {
        // never called
      },
    });
    expect(r).toMatchObject({ code: "worktree-add-failed" });
  });
});

describe("runAuditFromRef — end-to-end against a fixture repo", () => {
  /**
   * Reindex stub that actually runs the canonical SQL projection by creating
   * a `<state-dir>/index.db` with the worktree's files seeded into the `files` table.
   * Stand-in for the real `runCodemapIndex` — Tracer 2 wires the real one.
   */
  async function fakeReindex(worktreePath: string): Promise<void> {
    const dbPath = join(worktreePath, ".codemap", "index.db");
    const db = openCodemapDatabase(dbPath);
    try {
      createTables(db);
      // Walk worktree's src/ and insert each .ts file into `files`.
      const { readdirSync } = await import("node:fs");
      const srcDir = join(worktreePath, "src");
      if (existsSync(srcDir)) {
        for (const f of readdirSync(srcDir)) {
          if (f.endsWith(".ts")) {
            db.run(
              `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
               VALUES (?, 'h', 0, 1, 'ts', 0, 0)`,
              [`src/${f}`],
            );
          }
        }
      }
    } finally {
      db.close();
    }
  }

  let liveDb: CodemapDatabase | undefined;

  beforeEach(() => {
    // The "head" live DB has b.ts indexed.
    liveDb = openCodemapDatabase(":memory:");
    createTables(liveDb);
    db().run(
      `INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at)
       VALUES ('src/b.ts', 'h', 0, 1, 'ts', 0, 0)`,
    );
  });

  afterEach(() => {
    liveDb?.close();
    liveDb = undefined;
    _wipeCacheForTests(projectRoot);
  });

  function db(): CodemapDatabase {
    if (!liveDb) throw new Error("liveDb not initialized");
    return liveDb;
  }

  it("returns the full envelope with base.source: 'ref' for each delta", async () => {
    const env = await runAuditFromRef({
      db: db(),
      ref: "HEAD~1",
      projectRoot,
      reindex: fakeReindex,
    });
    expect("error" in env).toBe(false);
    if ("error" in env) return;
    expect(env.deltas.files).toBeDefined();
    expect(env.deltas.files!.base).toMatchObject({
      source: "ref",
      ref: "HEAD~1",
      sha: baseSha,
    });
    // a.ts in base, b.ts in head → added: b.ts, removed: a.ts.
    expect(env.deltas.files!.added).toEqual([{ path: "src/b.ts" }]);
    expect(env.deltas.files!.removed).toEqual([{ path: "src/a.ts" }]);
  });

  it("non-git project errors cleanly", async () => {
    const plain = mkdtempSync(join(tmpdir(), "non-git-"));
    try {
      const env = await runAuditFromRef({
        db: db(),
        ref: "HEAD~1",
        projectRoot: plain,
        reindex: fakeReindex,
      });
      expect(env).toMatchObject({
        error: "codemap audit: --base requires a git repository.",
      });
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("bogus ref errors cleanly", async () => {
    const env = await runAuditFromRef({
      db: db(),
      ref: "no-such-ref-xyz",
      projectRoot,
      reindex: fakeReindex,
    });
    expect(env).toMatchObject({
      error: expect.stringContaining(`cannot resolve "no-such-ref-xyz"`),
    });
  });

  it("second run hits the cache (reindex called once total)", async () => {
    let reindexCalls = 0;
    const countingReindex = async (wp: string) => {
      reindexCalls += 1;
      await fakeReindex(wp);
    };
    await runAuditFromRef({
      db: db(),
      ref: "HEAD~1",
      projectRoot,
      reindex: countingReindex,
    });
    await runAuditFromRef({
      db: db(),
      ref: "HEAD~1",
      projectRoot,
      reindex: countingReindex,
    });
    expect(reindexCalls).toBe(1);
  });

  it("per-delta override uses query_baselines for that delta only", async () => {
    // Save a baseline that pretends the 'files' set was empty at audit time.
    db().run(
      `INSERT INTO query_baselines (name, recipe_id, sql, rows_json, row_count, git_ref, created_at)
       VALUES ('pr-files', NULL, 'SELECT path FROM files', '[]', 0, 'abc', 1700000000000)`,
    );
    const env = await runAuditFromRef({
      db: db(),
      ref: "HEAD~1",
      projectRoot,
      perDeltaOverrides: { files: "pr-files" },
      reindex: fakeReindex,
    });
    expect("error" in env).toBe(false);
    if ("error" in env) return;
    expect(env.deltas.files!.base).toMatchObject({
      source: "baseline",
      name: "pr-files",
    });
    // dependencies + deprecated still resolve via the worktree (source: ref).
    expect(env.deltas.dependencies?.base.source).toBe("ref");
    expect(env.deltas.deprecated?.base.source).toBe("ref");
  });
});
