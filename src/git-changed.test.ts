import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  filterRowsByChangedFiles,
  getFilesChangedSince,
  PATH_COLUMNS,
} from "./git-changed";

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

describe("filterRowsByChangedFiles", () => {
  const changed = new Set(["src/a.ts", "src/b.tsx"]);

  it("keeps rows where file_path matches", () => {
    const out = filterRowsByChangedFiles(
      [
        { name: "Foo", file_path: "src/a.ts" },
        { name: "Bar", file_path: "src/c.ts" },
      ],
      changed,
    );
    expect(out).toEqual([{ name: "Foo", file_path: "src/a.ts" }]);
  });

  it("keeps rows where path matches", () => {
    const out = filterRowsByChangedFiles(
      [
        { path: "src/a.ts", line_count: 10 },
        { path: "src/c.ts", line_count: 20 },
      ],
      changed,
    );
    expect(out).toEqual([{ path: "src/a.ts", line_count: 10 }]);
  });

  it("keeps rows where from_path OR to_path matches (dependencies-shape)", () => {
    const out = filterRowsByChangedFiles(
      [
        { from_path: "src/a.ts", to_path: "src/x.ts" },
        { from_path: "src/y.ts", to_path: "src/b.tsx" },
        { from_path: "src/y.ts", to_path: "src/z.ts" },
      ],
      changed,
    );
    expect(out).toEqual([
      { from_path: "src/a.ts", to_path: "src/x.ts" },
      { from_path: "src/y.ts", to_path: "src/b.tsx" },
    ]);
  });

  it("passes through rows with no recognised path column", () => {
    const out = filterRowsByChangedFiles(
      [{ count: 42 }, { kind: "TODO", n: 7 }],
      changed,
    );
    expect(out).toHaveLength(2);
  });

  it("handles non-object rows by passing them through", () => {
    const out = filterRowsByChangedFiles([1, "x", null], changed);
    expect(out).toEqual([1, "x", null]);
  });

  it("PATH_COLUMNS covers the schema's path-bearing columns", () => {
    expect(PATH_COLUMNS).toContain("path");
    expect(PATH_COLUMNS).toContain("file_path");
    expect(PATH_COLUMNS).toContain("from_path");
    expect(PATH_COLUMNS).toContain("to_path");
    expect(PATH_COLUMNS).toContain("resolved_path");
  });
});

describe("getFilesChangedSince", () => {
  const root = process.cwd();

  it("returns ok set for HEAD (empty diff against itself)", () => {
    const r = getFilesChangedSince("HEAD", root);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.files).toBeInstanceOf(Set);
  });

  it("rejects empty ref", () => {
    const r = getFilesChangedSince("", root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("non-empty ref");
  });

  it("rejects unresolvable ref with a clean error", () => {
    const r = getFilesChangedSince("not-a-real-ref-xyz123", root);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cannot resolve");
  });

  describe("temp git repo", () => {
    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), "codemap-git-changed-"));
      git(["init", "-q", "-b", "main", "--template="]);
      git(["config", "user.email", "t@example.com"]);
      git(["config", "user.name", "T"]);
      git(["config", "commit.gpgsign", "false"]);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
    });

    it("includes paths with spaces from porcelain -z output", () => {
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

      const r = getFilesChangedSince(base, projectRoot);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.files.has("src/my module.ts")).toBe(true);
    });
  });
});
