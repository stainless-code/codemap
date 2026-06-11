import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createTables } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import {
  executeShowLookup,
  formatShowSearchSqlForQuery,
  isExactNamePattern,
  normalizeSearchInGlob,
  parseAndNormalizeSearchQuery,
  resolveExactNameFromParsedQuery,
  resolveSearchWithFts,
  resolveShowLookupMode,
  validateShowSnippetLookupArgs,
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

  it("normalizes absolute in: glob prefix to project-relative", () => {
    const r = parseAndNormalizeSearchQuery(
      "in:/tmp/project/src/**/*.ts",
      "/tmp/project",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.parsed.inGlob).toBe("src/**/*.ts");
  });
});

describe("normalizeSearchInGlob", () => {
  it("leaves relative globs unchanged", () => {
    expect(normalizeSearchInGlob("/tmp/project", "src/**/*.ts")).toBe(
      "src/**/*.ts",
    );
  });

  it("normalizes absolute globs", () => {
    expect(
      normalizeSearchInGlob("/tmp/project", "/tmp/project/src/api/*.ts"),
    ).toBe("src/api/*.ts");
  });
});

describe("validateShowSnippetLookupArgs", () => {
  it("rejects name and query together", () => {
    expect(
      validateShowSnippetLookupArgs({ name: "foo", query: "name:foo" }),
    ).toEqual({
      ok: false,
      error: "pass either name or query, not both.",
    });
  });

  it("rejects kind/in with query", () => {
    expect(
      validateShowSnippetLookupArgs({
        query: "name:foo",
        kind: "function",
      }),
    ).toEqual({
      ok: false,
      error:
        "kind / in apply to exact-name lookup only; use kind: / path: / in: inside query.",
    });
  });
});

describe("formatShowSearchSqlForQuery", () => {
  let db: CodemapDatabase;

  beforeEach(() => {
    db = openCodemapDatabase(":memory:");
    createTables(db);
  });

  afterEach(() => {
    db.close();
  });

  it("returns rendered SQL for kind + name query", () => {
    const result = formatShowSearchSqlForQuery(
      "kind:function name:entry",
      "/tmp",
      {
        withFtsCli: false,
        db,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain("kind = 'function'");
    expect(result.sql).toContain("name LIKE '%entry%'");
  });

  it("returns equality SQL for lone name:Token fast path", () => {
    const result = formatShowSearchSqlForQuery("name:hashContent", "/tmp", {
      withFtsCli: false,
      db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain("name = 'hashContent'");
    expect(result.sql).not.toContain("LIKE");
  });

  it("keeps LIKE SQL for name:%wild% slow tier", () => {
    const result = formatShowSearchSqlForQuery("name:%Sym%", "/tmp", {
      withFtsCli: false,
      db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sql).toContain("name LIKE '%\\%Sym\\%%'");
  });
});

describe("isExactNamePattern", () => {
  it("accepts literal tokens", () => {
    expect(isExactNamePattern("hashContent")).toBe(true);
    expect(isExactNamePattern("runShowCmd")).toBe(true);
  });

  it("rejects unescaped wildcards", () => {
    expect(isExactNamePattern("%foo%")).toBe(false);
    expect(isExactNamePattern("foo_bar")).toBe(false);
  });

  it("allows escaped wildcards", () => {
    expect(isExactNamePattern("foo\\%bar")).toBe(true);
  });
});

describe("resolveExactNameFromParsedQuery", () => {
  it("resolves lone name pattern", () => {
    expect(
      resolveExactNameFromParsedQuery({
        namePatterns: ["MySymbol"],
        freeText: [],
      }),
    ).toBe("MySymbol");
  });

  it("returns undefined when kind is set", () => {
    expect(
      resolveExactNameFromParsedQuery({
        kind: "function",
        namePatterns: ["MySymbol"],
        freeText: [],
      }),
    ).toBeUndefined();
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

  it("name:Token fast path matches exact lookup rows", () => {
    const exact = executeShowLookup(
      db,
      { ok: true, kind: "exact", name: "foo", inPath: undefined },
      { withFtsCli: false },
    );
    const query = executeShowLookup(
      db,
      {
        ok: true,
        kind: "query",
        parsed: { namePatterns: ["foo"], freeText: [] },
      },
      { withFtsCli: false },
    );
    expect(query.matches).toEqual(exact.matches);
  });

  it("kind + name uses slow LIKE tier even for literal name token", () => {
    const exact = executeShowLookup(
      db,
      { ok: true, kind: "exact", name: "foo", inPath: undefined },
      { withFtsCli: false },
    );
    const slow = executeShowLookup(
      db,
      {
        ok: true,
        kind: "query",
        parsed: {
          kind: "function",
          namePatterns: ["foo"],
          freeText: [],
        },
      },
      { withFtsCli: false },
    );
    expect(slow.matches.length).toBeLessThanOrEqual(exact.matches.length);
    expect(slow.matches.every((m) => m.kind === "function")).toBe(true);
  });

  it("name:%Sym% stays on slow LIKE tier", () => {
    const slow = executeShowLookup(
      db,
      {
        ok: true,
        kind: "query",
        parsed: { namePatterns: ["%Sym%"], freeText: [] },
      },
      { withFtsCli: false },
    );
    expect(
      resolveExactNameFromParsedQuery({
        namePatterns: ["%Sym%"],
        freeText: [],
      }),
    ).toBeUndefined();
    expect(slow.matches).toEqual([]);
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
