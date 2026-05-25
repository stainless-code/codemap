import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createTables } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import {
  executeShowLookup,
  parseAndNormalizeSearchQuery,
  resolveSearchWithFts,
  resolveShowLookupMode,
} from "./show-search-mode";

describe("parseAndNormalizeSearchQuery", () => {
  it("normalizes path: to project-relative", () => {
    const r = parseAndNormalizeSearchQuery(
      "path:src/api name:foo",
      "/tmp/project",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.path).toBe("src/api");
  });
});

describe("resolveShowLookupMode", () => {
  const root = "/tmp/project";

  it("requires name or query", () => {
    expect(resolveShowLookupMode({}, root)).toEqual({
      ok: false,
      error: "name or query is required.",
    });
  });

  it("rejects name and query together", () => {
    expect(
      resolveShowLookupMode({ name: "foo", query: "name:foo" }, root),
    ).toEqual({
      ok: false,
      error: "pass either name or query, not both.",
    });
  });

  it("rejects kind/in with query", () => {
    expect(
      resolveShowLookupMode({ query: "name:foo", kind: "function" }, root),
    ).toEqual({
      ok: false,
      error:
        "kind / in apply to exact-name lookup only; use kind: / path: / in: inside query.",
    });
  });

  it("parses exact-name mode with normalized in:", () => {
    const mode = resolveShowLookupMode(
      { name: "foo", in: "/tmp/project/src/cli" },
      root,
    );
    expect(mode).toEqual({
      ok: true,
      kind: "exact",
      name: "foo",
      inPath: "src/cli",
    });
  });

  it("parses query mode", () => {
    const mode = resolveShowLookupMode(
      { query: "kind:function name:Auth" },
      root,
    );
    expect(mode.ok).toBe(true);
    if (!mode.ok || mode.kind !== "query") return;
    expect(mode.parsed.kind).toBe("function");
    expect(mode.parsed.namePatterns).toEqual(["Auth"]);
  });

  it("propagates query parse errors", () => {
    const mode = resolveShowLookupMode({ query: "bogus:x" }, root);
    expect(mode.ok).toBe(false);
    if (mode.ok) return;
    expect(mode.error).toContain("unknown search field");
  });
});

describe("resolveSearchWithFts", () => {
  let db: CodemapDatabase;

  beforeEach(() => {
    db = openCodemapDatabase(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("skips FTS when no free-text tokens", () => {
    expect(
      resolveSearchWithFts(db, { withFtsCli: true, freeTextCount: 0 }),
    ).toEqual({ useFts: false });
  });

  it("warns when FTS requested but source_fts is empty", () => {
    const r = resolveSearchWithFts(db, {
      withFtsCli: true,
      freeTextCount: 1,
    });
    expect(r.useFts).toBe(false);
    expect(r.warning).toContain("source_fts is empty");
  });
});

describe("executeShowLookup", () => {
  let db: CodemapDatabase;

  beforeEach(() => {
    db = openCodemapDatabase(":memory:");
    createTables(db);
    db.run(
      "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["src/a.ts", "h1", 10, 5, "ts", 1, 1],
    );
    db.run(
      `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export)
       VALUES (?, ?, 'function', 1, 1, 'function foo(): void', 1, 0)`,
      ["src/a.ts", "foo"],
    );
  });

  afterEach(() => {
    db.close();
  });

  it("exact mode uses findSymbolsByName", () => {
    const r = executeShowLookup(
      db,
      { ok: true, kind: "exact", name: "foo", inPath: undefined },
      { withFtsCli: false },
    );
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]!.name).toBe("foo");
    expect(r.warning).toBeUndefined();
  });

  it("query mode returns empty matches without error envelope", () => {
    const r = executeShowLookup(
      db,
      {
        ok: true,
        kind: "query",
        parsed: {
          kind: "class",
          namePatterns: ["missing"],
          freeText: [],
        },
      },
      { withFtsCli: false },
    );
    expect(r.matches).toEqual([]);
  });

  it("query mode with FTS flag warns when source_fts empty", () => {
    const r = executeShowLookup(
      db,
      {
        ok: true,
        kind: "query",
        parsed: {
          namePatterns: [],
          freeText: ["token"],
        },
      },
      { withFtsCli: true },
    );
    expect(r.matches).toEqual([]);
    expect(r.warning).toContain("source_fts is empty");
  });
});
