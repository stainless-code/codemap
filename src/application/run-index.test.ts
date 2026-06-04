import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, getMeta, openDb, setMeta } from "../db";
import { hashContent } from "../hash";
import { configureResolver } from "../resolver";
import { initCodemap } from "../runtime";
import { openCodemapDatabase } from "../sqlite-db";
import { runCodemapIndex } from "./run-index";

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

describe("runCodemapIndex", () => {
  test("incremental on empty DB creates schema first (no missing meta table)", async () => {
    const root = mkdtempSync(join(tmpdir(), "codemap-run-index-"));
    writeFileSync(join(root, "package.json"), "{}");
    initCodemap(resolveCodemapConfig(root, {}));
    configureResolver(root, null);

    const db = openCodemapDatabase(":memory:");
    try {
      await expect(
        runCodemapIndex(db, { mode: "incremental", quiet: true }),
      ).resolves.toBeDefined();
    } finally {
      db.close();
    }
  });

  describe("incremental git repo", () => {
    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), "codemap-run-index-git-"));
      git(["init", "-q", "-b", "main"]);
      git(["config", "user.email", "t@example.com"]);
      git(["config", "user.name", "T"]);
      git(["config", "commit.gpgsign", "false"]);
      initCodemap(resolveCodemapConfig(projectRoot, undefined));
      configureResolver(projectRoot, null);
    });

    afterEach(() => {
      rmSync(projectRoot, { recursive: true, force: true });
    });

    test("deletes and re-indexes in one incremental run when both change", async () => {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(join(projectRoot, "src/a.ts"), "export const a = 1;\n");
      writeFileSync(join(projectRoot, "src/b.ts"), "export const b = 1;\n");
      const base = commitAll("add a and b");

      git(["rm", "src/a.ts"]);
      commitAll("delete a");
      const bSource = "export const b = 2;\n";
      writeFileSync(join(projectRoot, "src/b.ts"), bSource);

      const db = openDb();
      try {
        createTables(db);
        db.run(
          "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/a.ts', 'old', 1, 1, 'typescript', 1, 1)",
        );
        db.run(
          "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/b.ts', 'old', 1, 1, 'typescript', 1, 1)",
        );
        setMeta(db, "last_indexed_commit", base);

        await runCodemapIndex(db, { mode: "incremental", quiet: true });

        const aRow = db
          .query<{ path: string }>("SELECT path FROM files WHERE path = ?")
          .get("src/a.ts");
        expect(aRow).toBeFalsy();

        const bRow = db
          .query<{ content_hash: string }>(
            "SELECT content_hash FROM files WHERE path = ?",
          )
          .get("src/b.ts");
        expect(bRow?.content_hash).toBe(hashContent(bSource));
      } finally {
        closeDb(db);
      }
    });

    test("incremental re-index re-resolves type_heritage when the defining file changes", async () => {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src/types.ts"),
        "export interface Base { x: string; }\nexport interface Child extends Base { y: string; }\n",
      );
      writeFileSync(join(projectRoot, "package.json"), "{}");
      const indexedAt = commitAll("add types");

      const db = openDb();
      try {
        await runCodemapIndex(db, { mode: "full", quiet: true });

        const beforeStale = db
          .query<{ resolution_kind: string; base_symbol_id: number | null }>(
            "SELECT resolution_kind, base_symbol_id FROM type_heritage WHERE child_name = 'Child'",
          )
          .get();
        expect(beforeStale?.resolution_kind).toBe("same-file");
        expect(beforeStale?.base_symbol_id).not.toBeNull();

        db.run(
          "UPDATE type_heritage SET base_symbol_id = NULL, base_file_path = NULL, resolution_kind = 'unresolved' WHERE child_name = 'Child'",
        );

        writeFileSync(
          join(projectRoot, "src/types.ts"),
          "export interface Base { x: string; z: boolean; }\nexport interface Child extends Base { y: string; }\n",
        );
        commitAll("extend base");

        setMeta(db, "last_indexed_commit", indexedAt);

        await runCodemapIndex(db, { mode: "incremental", quiet: true });

        const row = db
          .query<{
            base_symbol_id: number | null;
            resolution_kind: string;
            base_file_path: string | null;
          }>(
            "SELECT base_symbol_id, resolution_kind, base_file_path FROM type_heritage WHERE child_name = 'Child'",
          )
          .get();
        expect(row?.resolution_kind).toBe("same-file");
        expect(row?.base_file_path).toBe("src/types.ts");
        expect(row?.base_symbol_id).not.toBeNull();
      } finally {
        closeDb(db);
      }
    });

    test("incremental re-index re-resolves calls when the defining file changes", async () => {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src/consumer.ts"),
        "function helper() { return 1; }\nexport function run() { helper(); }\n",
      );
      writeFileSync(join(projectRoot, "package.json"), "{}");
      const indexedAt = commitAll("add consumer");

      const db = openDb();
      try {
        await runCodemapIndex(db, { mode: "full", quiet: true });

        const beforeStale = db
          .query<{
            callee_symbol_id: number | null;
            callee_resolution_kind: string | null;
          }>(
            "SELECT callee_symbol_id, callee_resolution_kind FROM calls WHERE file_path = 'src/consumer.ts' AND callee_name = 'helper'",
          )
          .get();
        expect(beforeStale?.callee_resolution_kind).toBe("same-file");
        expect(beforeStale?.callee_symbol_id).not.toBeNull();

        db.run(
          "UPDATE calls SET callee_symbol_id = NULL, callee_resolution_kind = 'unresolved' WHERE file_path = 'src/consumer.ts' AND callee_name = 'helper'",
        );

        writeFileSync(
          join(projectRoot, "src/consumer.ts"),
          "function helper() { return 2; }\nexport function run() { helper(); }\n",
        );
        commitAll("change helper body");

        setMeta(db, "last_indexed_commit", indexedAt);

        await runCodemapIndex(db, { mode: "incremental", quiet: true });

        const row = db
          .query<{
            callee_symbol_id: number | null;
            callee_resolution_kind: string | null;
          }>(
            "SELECT callee_symbol_id, callee_resolution_kind FROM calls WHERE file_path = 'src/consumer.ts' AND callee_name = 'helper'",
          )
          .get();
        expect(row?.callee_resolution_kind).toBe("same-file");
        expect(row?.callee_symbol_id).not.toBeNull();
        expect(
          (
            db
              .query<{ n: number }>(
                "SELECT COUNT(*) AS n FROM unresolved_calls WHERE file_path = 'src/consumer.ts' AND callee_name = 'helper'",
              )
              .get() as { n: number }
          ).n,
        ).toBe(0);
      } finally {
        closeDb(db);
      }
    });

    test("incremental deletion-only run clears deleted file and runs call resolve", async () => {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(
        join(projectRoot, "src/util.ts"),
        "export function helper() { return 1; }\n",
      );
      writeFileSync(join(projectRoot, "package.json"), "{}");
      const indexedAt = commitAll("add util");

      const db = openDb();
      try {
        await runCodemapIndex(db, { mode: "full", quiet: true });
        expect(
          db
            .query<{ name: string }>(
              "SELECT name FROM symbols WHERE file_path = 'src/util.ts' AND name = 'helper'",
            )
            .get()?.name,
        ).toBe("helper");

        git(["rm", "src/util.ts"]);
        commitAll("delete util");

        setMeta(db, "last_indexed_commit", indexedAt);

        const result = await runCodemapIndex(db, {
          mode: "incremental",
          quiet: true,
        });
        expect(result.idle).toBe(true);
        expect(
          db
            .query<{ path: string }>("SELECT path FROM files WHERE path = ?")
            .get("src/util.ts"),
        ).toBeFalsy();
        expect(getMeta(db, "last_indexed_commit")).not.toBe(indexedAt);
      } finally {
        closeDb(db);
      }
    });
  });
});
