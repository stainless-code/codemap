import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createTables } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import {
  buildSymbolSearchSql,
  formatSymbolSearchSqlForDisplay,
  searchSymbols,
} from "./search-engine";
import type { ParsedSearchQuery } from "./search-query-parser";

let db: CodemapDatabase;

beforeEach(() => {
  db = openCodemapDatabase(":memory:");
  createTables(db);
  db.run(
    "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)",
    [
      "src/api/auth.ts",
      "h1",
      100,
      30,
      "ts",
      1,
      1,
      "src/cli/cmd-show.ts",
      "h2",
      80,
      20,
      "ts",
      1,
      1,
    ],
  );
  db.run(
    `INSERT INTO symbols (file_path, name, kind, line_start, line_end, signature, is_exported, is_default_export)
     VALUES
       ('src/api/auth.ts', 'authenticate', 'function', 5, 15, 'function authenticate(): void', 1, 0),
       ('src/api/auth.ts', 'AuthContext', 'interface', 1, 3, 'interface AuthContext', 1, 0),
       ('src/cli/cmd-show.ts', 'runShowCmd', 'function', 20, 25, 'async function runShowCmd(): Promise<void>', 1, 0)`,
  );
});

afterEach(() => {
  db.close();
});

describe("buildSymbolSearchSql", () => {
  it("kind + name patterns compose with AND", () => {
    const parsed: ParsedSearchQuery = {
      kind: "function",
      namePatterns: ["Auth"],
      freeText: [],
    };
    const built = buildSymbolSearchSql({ parsed });
    expect(built.params).toEqual(["function", "%Auth%"]);
    expect(built.sql).toContain("kind = ?");
    expect(built.sql).toContain("name LIKE ?");
  });

  it("--print-sql inlines literals safely", () => {
    const parsed: ParsedSearchQuery = {
      kind: "function",
      namePatterns: ["O'Brien"],
      freeText: [],
    };
    const built = buildSymbolSearchSql({ parsed });
    const rendered = formatSymbolSearchSqlForDisplay(built);
    expect(rendered).toContain("'function'");
    expect(rendered).toContain("'%O''Brien%'");
  });
});

describe("searchSymbols", () => {
  it("kind:function name:auth returns matching rows", () => {
    const rows = searchSymbols(db, {
      parsed: {
        kind: "function",
        namePatterns: ["auth"],
        freeText: [],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("authenticate");
  });

  it("path: prefix narrows file scope", () => {
    const rows = searchSymbols(db, {
      parsed: {
        namePatterns: ["run"],
        freeText: [],
        path: "src/cli",
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.file_path).toBe("src/cli/cmd-show.ts");
  });

  it("in: glob filters file_path", () => {
    const rows = searchSymbols(db, {
      parsed: {
        kind: "function",
        namePatterns: [],
        freeText: [],
        inGlob: "src/api/*",
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe("authenticate");
  });

  it("free text uses name LIKE when FTS off", () => {
    const rows = searchSymbols(db, {
      parsed: {
        namePatterns: [],
        freeText: ["Auth"],
      },
      withFts: false,
    });
    expect(rows.map((r) => r.name)).toEqual(["AuthContext"]);
  });
});
