import { describe, expect, it } from "bun:test";

import {
  createTables,
  insertExports,
  insertFile,
  insertImportsWithSpecifiers,
  insertSymbols,
  insertTypeHeritage,
} from "../db";
import type { SymbolRow } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import {
  expandHeritageResolveScope,
  resolveTypeHeritage,
} from "./heritage-resolver";

function freshDb() {
  const db = openCodemapDatabase(":memory:");
  createTables(db);
  return db;
}

function sym(
  file_path: string,
  name: string,
  kind: string,
  idHint?: Partial<SymbolRow>,
): SymbolRow {
  return {
    file_path,
    name,
    kind,
    line_start: 1,
    line_end: 1,
    signature: name,
    is_exported: 1,
    is_default_export: 0,
    members: null,
    doc_comment: null,
    value: null,
    parent_name: null,
    visibility: null,
    scope_local_id: 0,
    ...idHint,
  };
}

describe("resolveTypeHeritage", () => {
  it("resolves same-file extends to module-level symbol", () => {
    const db = freshDb();
    try {
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "h",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertSymbols(db, [
        sym("src/a.ts", "Base", "interface"),
        sym("src/a.ts", "Derived", "interface", { line_start: 5 }),
      ]);
      insertTypeHeritage(db, [
        {
          child_file_path: "src/a.ts",
          child_name: "Derived",
          child_kind: "interface",
          child_line_start: 5,
          relation: "extends",
          base_simple_name: "Base",
          base_qualified_name: null,
          base_file_path: null,
          base_symbol_id: null,
          resolution_kind: "unresolved",
          type_args: null,
        },
      ]);
      const [row] = resolveTypeHeritage(db);
      expect(row?.resolution_kind).toBe("same-file");
      expect(row?.base_file_path).toBe("src/a.ts");
      expect(row?.base_symbol_id).toBe(1);
    } finally {
      db.close();
    }
  });

  it("resolves imported type alias base", () => {
    const db = freshDb();
    try {
      insertFile(db, {
        path: "src/base.ts",
        content_hash: "h1",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertFile(db, {
        path: "src/child.ts",
        content_hash: "h2",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertSymbols(db, [
        sym("src/base.ts", "Base", "type"),
        sym("src/child.ts", "Child", "interface"),
      ]);
      insertExports(db, [
        {
          file_path: "src/base.ts",
          name: "Base",
          kind: "type",
          is_default: 0,
          re_export_source: null,
          line_start: 1,
          line_end: 1,
          column_start: 0,
          column_end: 4,
          is_re_export: 0,
        },
      ]);
      insertImportsWithSpecifiers(
        db,
        [
          {
            file_path: "src/child.ts",
            source: "./base",
            resolved_path: "src/base.ts",
            specifiers: "Base",
            is_type_only: 1,
            line_number: 1,
          },
        ],
        [
          {
            file_path: "src/child.ts",
            source: "./base",
            imported_name: "Base",
            local_name: "Base",
            line: 1,
            column_start: 0,
            column_end: 4,
            kind: "named",
            is_type_only: 1,
            import_index: 0,
          },
        ],
      );
      insertTypeHeritage(db, [
        {
          child_file_path: "src/child.ts",
          child_name: "Child",
          child_kind: "interface",
          child_line_start: 3,
          relation: "extends",
          base_simple_name: "Base",
          base_qualified_name: null,
          base_file_path: null,
          base_symbol_id: null,
          resolution_kind: "unresolved",
          type_args: null,
        },
      ]);
      const [row] = resolveTypeHeritage(db);
      expect(row?.resolution_kind).toBe("imported");
      expect(row?.base_file_path).toBe("src/base.ts");
      expect(row?.base_symbol_id).toBe(1);
    } finally {
      db.close();
    }
  });

  it("does not resolve expression heritage bases", () => {
    const db = freshDb();
    try {
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "h",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertSymbols(db, [
        sym("src/a.ts", "A", "interface"),
        sym("src/a.ts", "Weird", "interface", { line_start: 5 }),
      ]);
      insertTypeHeritage(db, [
        {
          child_file_path: "src/a.ts",
          child_name: "Weird",
          child_kind: "interface",
          child_line_start: 5,
          relation: "extends",
          base_simple_name: "A",
          base_qualified_name: "(expression)",
          base_file_path: null,
          base_symbol_id: null,
          resolution_kind: "unresolved",
          type_args: null,
        },
      ]);
      const [row] = resolveTypeHeritage(db);
      expect(row?.resolution_kind).toBe("unresolved");
      expect(row?.base_file_path).toBeNull();
    } finally {
      db.close();
    }
  });

  it("leaves qualified-unresolved rows unchanged", () => {
    const db = freshDb();
    try {
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "h",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertTypeHeritage(db, [
        {
          child_file_path: "src/a.ts",
          child_name: "Child",
          child_kind: "interface",
          child_line_start: 1,
          relation: "extends",
          base_simple_name: "Base",
          base_qualified_name: "pkg.Base",
          base_file_path: null,
          base_symbol_id: null,
          resolution_kind: "qualified-unresolved",
          type_args: null,
        },
      ]);
      const [row] = resolveTypeHeritage(db);
      expect(row?.resolution_kind).toBe("qualified-unresolved");
      expect(row?.base_file_path).toBeNull();
    } finally {
      db.close();
    }
  });

  it("prefers module-level symbol over nested homonym", () => {
    const db = freshDb();
    try {
      insertFile(db, {
        path: "src/a.ts",
        content_hash: "h",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertSymbols(db, [
        sym("src/a.ts", "Base", "interface", { scope_local_id: 0 }),
        sym("src/a.ts", "Base", "interface", { scope_local_id: 2 }),
        sym("src/a.ts", "Derived", "interface", { line_start: 10 }),
      ]);
      insertTypeHeritage(db, [
        {
          child_file_path: "src/a.ts",
          child_name: "Derived",
          child_kind: "interface",
          child_line_start: 10,
          relation: "extends",
          base_simple_name: "Base",
          base_qualified_name: null,
          base_file_path: null,
          base_symbol_id: null,
          resolution_kind: "unresolved",
          type_args: null,
        },
      ]);
      const [row] = resolveTypeHeritage(db);
      expect(row?.base_symbol_id).toBe(1);
    } finally {
      db.close();
    }
  });

  it("re-resolves consumer rows when scoped to changed base file only", () => {
    const db = freshDb();
    try {
      insertFile(db, {
        path: "src/base.ts",
        content_hash: "h1",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertFile(db, {
        path: "src/child.ts",
        content_hash: "h2",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertSymbols(db, [
        sym("src/base.ts", "Base", "interface"),
        sym("src/child.ts", "Child", "interface"),
      ]);
      insertExports(db, [
        {
          file_path: "src/base.ts",
          name: "Base",
          kind: "interface",
          is_default: 0,
          re_export_source: null,
          line_start: 1,
          line_end: 1,
          column_start: 0,
          column_end: 4,
          is_re_export: 0,
        },
      ]);
      insertImportsWithSpecifiers(
        db,
        [
          {
            file_path: "src/child.ts",
            source: "./base",
            resolved_path: "src/base.ts",
            specifiers: "Base",
            is_type_only: 1,
            line_number: 1,
          },
        ],
        [
          {
            file_path: "src/child.ts",
            source: "./base",
            imported_name: "Base",
            local_name: "Base",
            line: 1,
            column_start: 0,
            column_end: 4,
            kind: "named",
            is_type_only: 1,
            import_index: 0,
          },
        ],
      );
      insertTypeHeritage(db, [
        {
          child_file_path: "src/child.ts",
          child_name: "Child",
          child_kind: "interface",
          child_line_start: 3,
          relation: "extends",
          base_simple_name: "Base",
          base_qualified_name: null,
          base_file_path: "src/base.ts",
          base_symbol_id: null,
          resolution_kind: "imported",
          type_args: null,
        },
      ]);
      const [row] = resolveTypeHeritage(db, ["src/base.ts"]);
      expect(row?.base_symbol_id).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe("expandHeritageResolveScope", () => {
  it("includes importers and consumers of changed base files", () => {
    const db = freshDb();
    try {
      insertFile(db, {
        path: "src/base.ts",
        content_hash: "h1",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertFile(db, {
        path: "src/child.ts",
        content_hash: "h2",
        size: 1,
        line_count: 1,
        language: "ts",
        last_modified: 0,
        indexed_at: 0,
      });
      insertImportsWithSpecifiers(
        db,
        [
          {
            file_path: "src/child.ts",
            source: "./base",
            resolved_path: "src/base.ts",
            specifiers: "Base",
            is_type_only: 1,
            line_number: 1,
          },
        ],
        [
          {
            file_path: "src/child.ts",
            source: "./base",
            imported_name: "Base",
            local_name: "Base",
            line: 1,
            column_start: 0,
            column_end: 4,
            kind: "named",
            is_type_only: 1,
            import_index: 0,
          },
        ],
      );
      insertTypeHeritage(db, [
        {
          child_file_path: "src/child.ts",
          child_name: "Child",
          child_kind: "interface",
          child_line_start: 3,
          relation: "extends",
          base_simple_name: "Base",
          base_qualified_name: null,
          base_file_path: "src/base.ts",
          base_symbol_id: null,
          resolution_kind: "imported",
          type_args: null,
        },
      ]);
      const scope = expandHeritageResolveScope(db, ["src/base.ts"]);
      expect(scope.sort()).toEqual(["src/base.ts", "src/child.ts"]);
    } finally {
      db.close();
    }
  });
});
