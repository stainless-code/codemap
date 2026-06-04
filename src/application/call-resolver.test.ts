import { describe, expect, it } from "bun:test";

import {
  createTables,
  getMeta,
  insertCalls,
  insertExports,
  insertFile,
  insertImportsWithSpecifiers,
  insertScopes,
  insertSymbols,
} from "../db";
import type { SymbolRow } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import {
  calleeBindingName,
  META_UNRESOLVED_CALLS_RESIDUAL as META_KEY,
  resolveCalls,
  scopeLocalIdForLine,
} from "./call-resolver";

function freshDb() {
  const db = openCodemapDatabase(":memory:");
  createTables(db);
  return db;
}

function sym(
  file_path: string,
  name: string,
  kind: string,
  extra?: Partial<SymbolRow>,
): SymbolRow {
  return {
    file_path,
    name,
    kind,
    line_start: 1,
    line_end: 3,
    signature: name,
    is_exported: 1,
    is_default_export: 0,
    members: null,
    doc_comment: null,
    value: null,
    parent_name: null,
    visibility: null,
    scope_local_id: 0,
    ...extra,
  };
}

function seedFile(db: ReturnType<typeof freshDb>, path: string, hash = "h") {
  insertFile(db, {
    path,
    content_hash: hash,
    size: 1,
    line_count: 20,
    language: "ts",
    last_modified: 0,
    indexed_at: 0,
  });
}

describe("calleeBindingName", () => {
  it("returns simple identifiers unchanged", () => {
    expect(calleeBindingName("createClient")).toBe("createClient");
  });

  it("uses the terminal segment for member chains", () => {
    expect(calleeBindingName("target.ping")).toBe("ping");
    expect(calleeBindingName("this.run")).toBe("run");
  });
});

describe("resolveCalls", () => {
  it("resolves imported callees to module-level symbols", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/lib/util.ts");
      seedFile(db, "src/consumer.ts");
      insertSymbols(db, [sym("src/lib/util.ts", "helper", "function")]);
      insertExports(db, [
        {
          file_path: "src/lib/util.ts",
          name: "helper",
          kind: "function",
          is_default: 0,
          re_export_source: null,
          line_start: 1,
          line_end: 3,
          column_start: 0,
          column_end: 0,
          is_re_export: 0,
        },
      ]);
      insertImportsWithSpecifiers(
        db,
        [
          {
            file_path: "src/consumer.ts",
            source: "./lib/util",
            resolved_path: "src/lib/util.ts",
            specifiers: "helper",
            is_type_only: 0,
            line_number: 1,
          },
        ],
        [
          {
            file_path: "src/consumer.ts",
            source: "./lib/util",
            imported_name: "helper",
            local_name: "helper",
            line: 1,
            column_start: 0,
            column_end: 6,
            kind: "named",
            is_type_only: 0,
            import_index: 0,
          },
        ],
      );
      insertScopes(db, [
        {
          file_path: "src/consumer.ts",
          local_id: 0,
          kind: "module",
          parent_local_id: null,
          line_start: 1,
          line_end: 20,
          owner_symbol_name: null,
        },
        {
          file_path: "src/consumer.ts",
          local_id: 1,
          kind: "function",
          parent_local_id: 0,
          line_start: 5,
          line_end: 12,
          owner_symbol_name: "run",
        },
      ]);
      insertCalls(db, [
        {
          file_path: "src/consumer.ts",
          caller_name: "run",
          caller_scope: "run",
          callee_name: "helper",
          line_start: 8,
          column_start: 2,
          column_end: 8,
        },
      ]);

      const stats = resolveCalls(db);
      expect(stats).toEqual({ total: 1, resolved: 1, unresolved: 0 });
      expect(
        db
          .query<{
            callee_symbol_id: number | null;
            callee_resolution_kind: string;
          }>(
            "SELECT callee_symbol_id, callee_resolution_kind FROM calls WHERE id = 1",
          )
          .get(),
      ).toMatchObject({
        callee_resolution_kind: "imported",
      });
      expect(
        (
          db.query("SELECT COUNT(*) AS n FROM unresolved_calls").get() as {
            n: number;
          }
        ).n,
      ).toBe(0);
      expect(getMeta(db, META_KEY)).toBe("0");
    } finally {
      db.close();
    }
  });

  it("queues unresolved sites when callee has no binding", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      insertScopes(db, [
        {
          file_path: "src/a.ts",
          local_id: 0,
          kind: "module",
          parent_local_id: null,
          line_start: 1,
          line_end: 10,
          owner_symbol_name: null,
        },
        {
          file_path: "src/a.ts",
          local_id: 1,
          kind: "function",
          parent_local_id: 0,
          line_start: 2,
          line_end: 8,
          owner_symbol_name: "main",
        },
      ]);
      insertCalls(db, [
        {
          file_path: "src/a.ts",
          caller_name: "main",
          caller_scope: "main",
          callee_name: "missingFn",
          line_start: 5,
          column_start: 4,
          column_end: 13,
        },
      ]);

      const stats = resolveCalls(db);
      expect(stats).toEqual({ total: 1, resolved: 0, unresolved: 1 });
      const row = db
        .query<{ callee_resolution_kind: string }>(
          "SELECT callee_resolution_kind FROM calls",
        )
        .get();
      expect(row?.callee_resolution_kind).toBe("unresolved");
      expect(
        (
          db
            .query<{ callee_name: string }>(
              "SELECT callee_name FROM unresolved_calls",
            )
            .get() as { callee_name: string }
        ).callee_name,
      ).toBe("missingFn");
      expect(getMeta(db, META_KEY)).toBe("1");
    } finally {
      db.close();
    }
  });

  it("scoped resolve only touches listed files", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      seedFile(db, "src/b.ts");
      insertScopes(db, [
        {
          file_path: "src/a.ts",
          local_id: 0,
          kind: "module",
          parent_local_id: null,
          line_start: 1,
          line_end: 10,
          owner_symbol_name: null,
        },
        {
          file_path: "src/b.ts",
          local_id: 0,
          kind: "module",
          parent_local_id: null,
          line_start: 1,
          line_end: 10,
          owner_symbol_name: null,
        },
      ]);
      insertCalls(db, [
        {
          file_path: "src/a.ts",
          caller_name: "fn",
          caller_scope: "fn",
          callee_name: "unknownA",
          line_start: 3,
          column_start: 0,
          column_end: 8,
        },
        {
          file_path: "src/b.ts",
          caller_name: "fn",
          caller_scope: "fn",
          callee_name: "unknownB",
          line_start: 3,
          column_start: 0,
          column_end: 8,
        },
      ]);
      resolveCalls(db);
      resolveCalls(db, { filePaths: ["src/a.ts"] });

      expect(
        (
          db
            .query<{ n: number }>(
              "SELECT COUNT(*) AS n FROM unresolved_calls WHERE file_path = 'src/a.ts'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(1);
      expect(
        (
          db
            .query<{ callee_resolution_kind: string }>(
              "SELECT callee_resolution_kind FROM calls WHERE file_path = 'src/b.ts'",
            )
            .get() as { callee_resolution_kind: string }
        ).callee_resolution_kind,
      ).toBe("unresolved");
      expect(
        (
          db
            .query<{ n: number }>(
              "SELECT COUNT(*) AS n FROM unresolved_calls WHERE file_path = 'src/b.ts'",
            )
            .get() as { n: number }
        ).n,
      ).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("scopeLocalIdForLine", () => {
  it("picks the innermost scope containing the line", () => {
    const db = freshDb();
    try {
      seedFile(db, "src/a.ts");
      insertScopes(db, [
        {
          file_path: "src/a.ts",
          local_id: 0,
          kind: "module",
          parent_local_id: null,
          line_start: 1,
          line_end: 20,
          owner_symbol_name: null,
        },
        {
          file_path: "src/a.ts",
          local_id: 2,
          kind: "function",
          parent_local_id: 0,
          line_start: 5,
          line_end: 15,
          owner_symbol_name: "inner",
        },
      ]);
      expect(scopeLocalIdForLine(db, "src/a.ts", 10)).toBe(2);
      expect(scopeLocalIdForLine(db, "src/a.ts", 1)).toBe(0);
    } finally {
      db.close();
    }
  });
});
