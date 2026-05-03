import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createTables } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { findImpact } from "./impact-engine";

let db: CodemapDatabase;

function seedFile(path: string, hash = "h") {
  db.run(
    "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [path, hash, 100, 30, "ts", 1, 1],
  );
}

function seedSymbol(name: string, file: string, kind = "function") {
  db.run(
    `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export)
     VALUES (?, ?, ?, 1, 10, ?, 0, 0)`,
    [file, name, kind, `${kind} ${name}()`],
  );
}

function seedCall(file: string, caller: string, callee: string) {
  db.run(
    "INSERT INTO calls (file_path, caller_name, caller_scope, callee_name) VALUES (?, ?, ?, ?)",
    [file, caller, "function", callee],
  );
}

function seedDep(from: string, to: string) {
  db.run("INSERT INTO dependencies (from_path, to_path) VALUES (?, ?)", [
    from,
    to,
  ]);
}

function seedImport(file: string, source: string, resolved: string | null) {
  db.run(
    `INSERT INTO imports (file_path, source, resolved_path, specifiers, is_type_only, line_number)
     VALUES (?, ?, ?, '[]', 0, 1)`,
    [file, source, resolved],
  );
}

beforeEach(() => {
  db = openCodemapDatabase(":memory:");
  createTables(db);
});

afterEach(() => {
  db.close();
});

describe("findImpact — symbol target via calls graph", () => {
  beforeEach(() => {
    // Three files, chain of calls: a → b → c → d, plus a → c (shortcut).
    seedFile("src/a.ts");
    seedFile("src/b.ts");
    seedFile("src/c.ts");
    seedFile("src/d.ts");
    seedSymbol("a", "src/a.ts");
    seedSymbol("b", "src/b.ts");
    seedSymbol("c", "src/c.ts");
    seedSymbol("d", "src/d.ts");
    seedCall("src/a.ts", "a", "b");
    seedCall("src/a.ts", "a", "c");
    seedCall("src/b.ts", "b", "c");
    seedCall("src/c.ts", "c", "d");
  });

  it("walks down (callees) from `a` reaches b, c, d", () => {
    const r = findImpact(db, { target: "a", direction: "down" });
    const names = r.matches.map((m) => m.name).sort();
    expect(names).toEqual(["b", "c", "d"]);
    // All hops should be `calls` edges, kind=symbol.
    for (const m of r.matches) {
      expect(m.kind).toBe("symbol");
      expect(m.edge).toBe("calls");
      expect(m.direction).toBe("down");
    }
  });

  it("walks up (callers) from `d` reaches c, b, a", () => {
    const r = findImpact(db, { target: "d", direction: "up" });
    const names = r.matches.map((m) => m.name).sort();
    expect(names).toEqual(["a", "b", "c"]);
    for (const m of r.matches) expect(m.edge).toBe("called_by");
  });

  it("direction=both unions up + down", () => {
    const r = findImpact(db, { target: "b", direction: "both" });
    // up from b: a. down from b: c, d.
    const upNames = r.matches
      .filter((m) => m.direction === "up")
      .map((m) => m.name)
      .sort();
    const downNames = r.matches
      .filter((m) => m.direction === "down")
      .map((m) => m.name)
      .sort();
    expect(upNames).toEqual(["a"]);
    expect(downNames).toEqual(["c", "d"]);
  });

  it("dedups same node across both directions (b ↔ c)", () => {
    // Add a back-edge: c calls b. Now from b, both `up` and `down` reach c.
    seedCall("src/c.ts", "c", "b");
    const r = findImpact(db, { target: "b", direction: "both" });
    // c shows up once per direction (different keys), not twice.
    const cMatches = r.matches.filter((m) => m.name === "c");
    expect(cMatches).toHaveLength(2);
    expect(cMatches.map((m) => m.direction).sort()).toEqual(["down", "up"]);
  });

  it("depth=1 stops at direct neighbours", () => {
    const r = findImpact(db, { target: "a", direction: "down", depth: 1 });
    const names = r.matches.map((m) => m.name).sort();
    expect(names).toEqual(["b", "c"]);
    for (const m of r.matches) expect(m.depth).toBe(1);
    expect(r.summary.terminated_by).toBe("depth");
  });

  it("depth=2 reaches d (via b or via the a→c shortcut)", () => {
    const r = findImpact(db, { target: "a", direction: "down", depth: 2 });
    const names = r.matches.map((m) => m.name).sort();
    expect(names).toEqual(["b", "c", "d"]);
    // d arrives at depth 2 (a→c→d shortest).
    expect(r.matches.find((m) => m.name === "d")?.depth).toBe(2);
  });

  it("returns empty match list for unknown target", () => {
    const r = findImpact(db, { target: "no-such-symbol" });
    expect(r.matches).toEqual([]);
    expect(r.summary.terminated_by).toBe("exhausted");
    expect(r.target.matched_in).toEqual([]);
  });

  it("captures call-site file_path for navigation", () => {
    const r = findImpact(db, { target: "a", direction: "down", depth: 1 });
    const b = r.matches.find((m) => m.name === "b");
    expect(b?.file_path).toBe("src/a.ts"); // the call site lives in a.ts
  });
});

describe("findImpact — cycle detection", () => {
  it("breaks self-loop without infinite recursion", () => {
    seedFile("src/a.ts");
    seedSymbol("a", "src/a.ts");
    seedCall("src/a.ts", "a", "a");
    const r = findImpact(db, { target: "a", direction: "down", depth: 5 });
    // Self-loop: a calls a. Direct neighbour is `a` itself, but our seed
    // path includes `,a,` so it's pre-visited and excluded.
    expect(r.matches).toEqual([]);
  });

  it("breaks 3-cycle (a → b → c → a)", () => {
    seedFile("src/a.ts");
    seedFile("src/b.ts");
    seedFile("src/c.ts");
    seedSymbol("a", "src/a.ts");
    seedSymbol("b", "src/b.ts");
    seedSymbol("c", "src/c.ts");
    seedCall("src/a.ts", "a", "b");
    seedCall("src/b.ts", "b", "c");
    seedCall("src/c.ts", "c", "a");
    const r = findImpact(db, { target: "a", direction: "down", depth: 10 });
    // Walk: a → b → c. Re-entering `a` is blocked by cycle detection.
    const names = r.matches.map((m) => m.name).sort();
    expect(names).toEqual(["b", "c"]);
  });
});

describe("findImpact — limit termination", () => {
  it("truncates at limit and reports terminated_by: limit", () => {
    seedFile("src/root.ts");
    seedSymbol("root", "src/root.ts");
    for (let i = 0; i < 10; i++) {
      const file = `src/leaf${i}.ts`;
      seedFile(file);
      seedSymbol(`leaf${i}`, file);
      seedCall("src/root.ts", "root", `leaf${i}`);
    }
    const r = findImpact(db, {
      target: "root",
      direction: "down",
      limit: 3,
    });
    expect(r.matches).toHaveLength(3);
    expect(r.summary.terminated_by).toBe("limit");
  });

  it("does NOT report `limit` when exact-fit", () => {
    seedFile("src/root.ts");
    seedSymbol("root", "src/root.ts");
    for (let i = 0; i < 3; i++) {
      const file = `src/leaf${i}.ts`;
      seedFile(file);
      seedSymbol(`leaf${i}`, file);
      seedCall("src/root.ts", "root", `leaf${i}`);
    }
    const r = findImpact(db, {
      target: "root",
      direction: "down",
      limit: 3,
    });
    expect(r.matches).toHaveLength(3);
    expect(r.summary.terminated_by).toBe("exhausted");
  });
});

describe("findImpact — file target via dependencies graph", () => {
  beforeEach(() => {
    seedFile("src/a.ts");
    seedFile("src/b.ts");
    seedFile("src/c.ts");
    seedDep("src/a.ts", "src/b.ts");
    seedDep("src/b.ts", "src/c.ts");
    seedDep("src/a.ts", "src/c.ts");
  });

  it("walks down (depends_on) from a.ts reaches b.ts, c.ts", () => {
    const r = findImpact(db, { target: "src/a.ts", direction: "down" });
    const paths = r.matches.map((m) => m.file_path).sort();
    expect(paths).toEqual(["src/b.ts", "src/c.ts"]);
    for (const m of r.matches) {
      expect(m.kind).toBe("file");
      expect(m.edge).toBe("depends_on");
    }
  });

  it("walks up (depended_on_by) from c.ts reaches b.ts, a.ts", () => {
    const r = findImpact(db, { target: "src/c.ts", direction: "up" });
    const paths = r.matches.map((m) => m.file_path).sort();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
    for (const m of r.matches) expect(m.edge).toBe("depended_on_by");
  });

  it("file-shaped target without indexed row is still treated as file", () => {
    const r = findImpact(db, {
      target: "src/unknown.ts",
      direction: "down",
    });
    expect(r.target.kind).toBe("file");
    expect(r.matches).toEqual([]);
  });
});

describe("findImpact — file target via imports graph", () => {
  it("walks up (imported_by) honours resolved_path only", () => {
    seedFile("src/a.ts");
    seedFile("src/b.ts");
    seedFile("src/c.ts");
    seedImport("src/a.ts", "./b", "src/b.ts");
    seedImport("src/b.ts", "./c", "src/c.ts");
    // Unresolved import should be filtered out by the IS NOT NULL clause.
    seedImport("src/a.ts", "react", null);

    const r = findImpact(db, {
      target: "src/c.ts",
      direction: "up",
      via: "imports",
    });
    const paths = r.matches.map((m) => m.file_path).sort();
    expect(paths).toEqual(["src/a.ts", "src/b.ts"]);
    for (const m of r.matches) expect(m.edge).toBe("imported_by");
  });
});

describe("findImpact — backend selection (--via)", () => {
  beforeEach(() => {
    seedFile("src/a.ts");
    seedFile("src/b.ts");
    seedSymbol("foo", "src/a.ts");
    seedDep("src/a.ts", "src/b.ts");
    seedCall("src/a.ts", "foo", "bar");
  });

  it("via=all on file target uses dependencies + imports (skips calls)", () => {
    const r = findImpact(db, {
      target: "src/a.ts",
      direction: "down",
      via: "all",
    });
    expect(r.via).toEqual(["dependencies", "imports"]);
    expect(r.skipped_backends).toBeUndefined();
  });

  it("via=all on symbol target uses calls only", () => {
    const r = findImpact(db, {
      target: "foo",
      direction: "down",
      via: "all",
    });
    expect(r.via).toEqual(["calls"]);
  });

  it("via=calls on file target lands in skipped_backends", () => {
    const r = findImpact(db, {
      target: "src/a.ts",
      direction: "down",
      via: "calls",
    });
    expect(r.via).toEqual([]);
    expect(r.skipped_backends).toEqual([
      {
        backend: "calls",
        reason: "calls table is symbol-level; target resolved to a file",
      },
    ]);
    expect(r.matches).toEqual([]);
  });

  it("via=dependencies on symbol target lands in skipped_backends", () => {
    const r = findImpact(db, {
      target: "foo",
      direction: "down",
      via: "dependencies",
    });
    expect(r.via).toEqual([]);
    expect(r.skipped_backends?.[0]?.backend).toBe("dependencies");
  });
});

describe("findImpact — target resolution", () => {
  it("treats path with `/` as file even when not indexed", () => {
    const r = findImpact(db, { target: "src/foo.ts", direction: "down" });
    expect(r.target.kind).toBe("file");
  });

  it("treats indexed bare-name file path as file", () => {
    seedFile("CHANGELOG.md");
    const r = findImpact(db, { target: "CHANGELOG.md", direction: "down" });
    expect(r.target.kind).toBe("file");
  });

  it("symbol target collects all defining files", () => {
    seedFile("src/a.ts");
    seedFile("src/b.ts");
    seedSymbol("dup", "src/a.ts");
    seedSymbol("dup", "src/b.ts");
    const r = findImpact(db, { target: "dup", direction: "down" });
    expect(r.target.kind).toBe("symbol");
    expect(r.target.matched_in).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("name match is case-sensitive (mirrors show-engine §D10)", () => {
    seedFile("src/a.ts");
    seedSymbol("Foo", "src/a.ts");
    const r = findImpact(db, { target: "foo", direction: "down" });
    expect(r.target.matched_in).toEqual([]);
  });
});

describe("findImpact — envelope shape + summary", () => {
  beforeEach(() => {
    seedFile("src/a.ts");
    seedFile("src/b.ts");
    seedSymbol("a", "src/a.ts");
    seedSymbol("b", "src/b.ts");
    seedCall("src/a.ts", "a", "b");
  });

  it("default direction is `both`, default depth is 3", () => {
    const r = findImpact(db, { target: "a" });
    expect(r.direction).toBe("both");
    expect(r.depth_limit).toBe(3);
  });

  it("summary.by_kind counts symbols and files separately", () => {
    seedFile("src/c.ts");
    seedDep("src/a.ts", "src/c.ts");
    const r = findImpact(db, { target: "src/a.ts", direction: "down" });
    expect(r.summary.by_kind).toMatchObject({ file: 1 });
  });

  it("depth=0 (sentinel) walks unbounded but still cycle-detects", () => {
    // Build chain a→b→c→…→f10 (length 10).
    for (let i = 0; i < 10; i++) {
      seedFile(`src/node${i}.ts`);
      seedSymbol(`node${i}`, `src/node${i}.ts`);
      if (i > 0) {
        seedCall(`src/node${i - 1}.ts`, `node${i - 1}`, `node${i}`);
      }
    }
    const r = findImpact(db, {
      target: "node0",
      direction: "down",
      depth: 0,
    });
    const names = r.matches.map((m) => m.name).sort();
    expect(names).toContain("node9"); // walked all the way through
  });
});
