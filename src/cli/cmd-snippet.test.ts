import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createTables } from "../db";
import type { CodemapDatabase } from "../db";
import { hashContent } from "../hash";
import { openCodemapDatabase } from "../sqlite-db";
import { buildSnippetResult, parseSnippetRest } from "./cmd-snippet";

describe("parseSnippetRest", () => {
  it("returns help on --help / -h", () => {
    expect(parseSnippetRest(["snippet", "--help"]).kind).toBe("help");
    expect(parseSnippetRest(["snippet", "-h"]).kind).toBe("help");
  });

  it("errors when no <name> given", () => {
    const r = parseSnippetRest(["snippet"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("missing <name>");
  });

  it("errors on extra positional argument", () => {
    const r = parseSnippetRest(["snippet", "foo", "bar"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("unexpected extra");
  });

  it("errors on unknown flag", () => {
    const r = parseSnippetRest(["snippet", "foo", "--with-context"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--with-context");
  });

  it("parses bare name", () => {
    const r = parseSnippetRest(["snippet", "foo"]);
    expect(r).toEqual({
      kind: "run",
      name: "foo",
      kindFilter: undefined,
      inPath: undefined,
      json: false,
    });
  });

  it("parses name + flags in any order", () => {
    const r = parseSnippetRest([
      "snippet",
      "--json",
      "--kind",
      "function",
      "foo",
      "--in",
      "src/cli",
    ]);
    expect(r).toEqual({
      kind: "run",
      name: "foo",
      kindFilter: "function",
      inPath: "src/cli",
      json: true,
    });
  });

  it("throws if rest[0] is not 'snippet'", () => {
    expect(() => parseSnippetRest(["query"])).toThrow();
  });
});

describe("buildSnippetResult — source enrichment + envelope", () => {
  let projectRoot: string;
  let db: CodemapDatabase;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "snippet-test-"));
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    db = openCodemapDatabase(":memory:");
    createTables(db);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    db.close();
  });

  function seed(
    file: string,
    content: string,
    name: string,
    lineRange: [number, number],
  ) {
    writeFileSync(join(projectRoot, file), content);
    db.run(
      "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        file,
        hashContent(content),
        content.length,
        content.split("\n").length,
        "ts",
        1,
        1,
      ],
    );
    db.run(
      `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export)
       VALUES (?, ?, 'function', ?, ?, ?, 1, 0)`,
      [file, name, lineRange[0], lineRange[1], `function ${name}(): void`],
    );
  }

  it("single match returns {matches} with source filled, no disambiguation", () => {
    seed("src/a.ts", "line 1\nline 2\nline 3\nline 4\n", "foo", [2, 3]);
    const matches = db
      .query("SELECT * FROM symbols WHERE name = ?")
      .all("foo") as never;
    const r = buildSnippetResult({ db, matches, projectRoot });
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.source).toBe("line 2\nline 3");
    expect(r.matches[0]!.stale).toBe(false);
    expect(r.matches[0]!.missing).toBe(false);
    expect(r.disambiguation).toBeUndefined();
  });

  it("flags stale: true when on-disk content drifts from indexed hash", () => {
    seed("src/b.ts", "old\nold line 2\n", "bar", [1, 2]);
    // Mutate the file after indexing.
    writeFileSync(join(projectRoot, "src/b.ts"), "new\ntotally different\n");
    const matches = db
      .query("SELECT * FROM symbols WHERE name = ?")
      .all("bar") as never;
    const r = buildSnippetResult({ db, matches, projectRoot });
    expect(r.matches[0]!.stale).toBe(true);
    expect(r.matches[0]!.source).toBe("new\ntotally different");
  });

  it("flags missing: true when file no longer exists on disk", () => {
    seed("src/c.ts", "x\n", "baz", [1, 1]);
    rmSync(join(projectRoot, "src/c.ts"));
    const matches = db
      .query("SELECT * FROM symbols WHERE name = ?")
      .all("baz") as never;
    const r = buildSnippetResult({ db, matches, projectRoot });
    expect(r.matches[0]!.missing).toBe(true);
    expect(r.matches[0]!.source).toBeUndefined();
  });

  it("multi-match adds disambiguation envelope", () => {
    seed("src/a.ts", "ok\n", "shared", [1, 1]);
    seed("src/b.ts", "ok\n", "shared", [1, 1]);
    const matches = db
      .query("SELECT * FROM symbols WHERE name = ? ORDER BY file_path")
      .all("shared") as never;
    const r = buildSnippetResult({ db, matches, projectRoot });
    expect(r.matches).toHaveLength(2);
    expect(r.disambiguation).toMatchObject({
      n: 2,
      by_kind: { function: 2 },
      files: ["src/a.ts", "src/b.ts"],
    });
  });
});
