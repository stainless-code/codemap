import { describe, expect, it } from "bun:test";

import {
  closeDb,
  createSchema,
  insertCalls,
  insertComponents,
  insertFile,
  insertImports,
  insertSymbols,
} from "../db";
import type { CodemapDatabase } from "../db";
import type { ParsedJsxElement } from "../extractors/jsx";
import { openCodemapDatabase } from "../sqlite-db";
import { synthesizeCallbackCalls } from "./callback-synthesis";
import { persistJsxElementsAndAttributes } from "./jsx-persist";

function seedMinimalReactFile(db: CodemapDatabase) {
  insertFile(db, {
    path: "src/Parent.tsx",
    content_hash: "p",
    size: 1,
    line_count: 20,
    language: "tsx",
    last_modified: 0,
    indexed_at: 0,
  });
  insertFile(db, {
    path: "src/Child.tsx",
    content_hash: "c",
    size: 1,
    line_count: 10,
    language: "tsx",
    last_modified: 0,
    indexed_at: 0,
  });
  insertSymbols(db, [
    {
      file_path: "src/Parent.tsx",
      name: "Parent",
      kind: "function",
      line_start: 1,
      line_end: 15,
      signature: "function Parent()",
      is_exported: 1,
      is_default_export: 0,
      members: null,
      doc_comment: null,
      value: null,
      parent_name: null,
      visibility: null,
      complexity: null,
      name_column_start: 0,
      name_column_end: 0,
      scope_local_id: 0,
    },
  ]);
  insertComponents(db, [
    {
      file_path: "src/Parent.tsx",
      name: "Parent",
      props_type: null,
      hooks_used: "[]",
      is_default_export: 0,
    },
    {
      file_path: "src/Child.tsx",
      name: "Child",
      props_type: null,
      hooks_used: "[]",
      is_default_export: 0,
    },
  ]);
  const elements: ParsedJsxElement[] = [
    {
      file_path: "src/Parent.tsx",
      component_name: "Child",
      line_start: 5,
      line_end: 5,
      column_start: 10,
      column_end: 17,
      is_self_closing: 1,
      is_fragment: 0,
      namespace_prefix: null,
      children_count: 0,
      is_lowercase: 0,
      _local_id: 1,
      _parent_local_id: null,
    },
  ];
  persistJsxElementsAndAttributes(db, elements, []);
  insertImports(db, [
    {
      file_path: "src/Parent.tsx",
      source: "./Child",
      resolved_path: "src/Child.tsx",
      specifiers: '["Child"]',
      is_type_only: 0,
      line_number: 1,
    },
  ]);
}

describe("synthesizeCallbackCalls", () => {
  it("inserts JSX parent→child heuristic edge when enabled", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      seedMinimalReactFile(db);

      const astBefore = db
        .query<{ n: number }>("SELECT COUNT(*) AS n FROM calls")
        .get() as { n: number };
      expect(astBefore.n).toBe(0);

      const result = synthesizeCallbackCalls(db);
      expect(result.jsxEdges).toBe(1);

      const row = db
        .query<{
          provenance: string;
          caller_name: string;
          callee_name: string;
        }>("SELECT provenance, caller_name, callee_name FROM calls")
        .get() as {
        provenance: string;
        caller_name: string;
        callee_name: string;
      };
      expect(row.provenance).toBe("heuristic");
      expect(row.caller_name).toBe("Parent");
      expect(row.callee_name).toBe("Child");
    } finally {
      closeDb(db);
    }
  });

  it("does not duplicate an existing ast edge for the same caller/callee", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      seedMinimalReactFile(db);
      insertCalls(db, [
        {
          file_path: "src/Parent.tsx",
          caller_name: "Parent",
          caller_scope: "Parent",
          callee_name: "Child",
          line_start: 5,
          column_start: 10,
          column_end: 17,
          provenance: "ast",
        },
      ]);

      const result = synthesizeCallbackCalls(db);
      expect(result.jsxEdges).toBe(0);
      expect(result.skippedDuplicate).toBe(1);
      expect(
        (
          db.query<{ n: number }>("SELECT COUNT(*) AS n FROM calls").get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
    } finally {
      closeDb(db);
    }
  });

  it("matches child component via import resolved_path, not homonyms elsewhere", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      seedMinimalReactFile(db);
      insertFile(db, {
        path: "src/OtherButton.tsx",
        content_hash: "o",
        size: 1,
        line_count: 5,
        language: "tsx",
        last_modified: 0,
        indexed_at: 0,
      });
      insertComponents(db, [
        {
          file_path: "src/OtherButton.tsx",
          name: "Child",
          props_type: null,
          hooks_used: "[]",
          is_default_export: 0,
        },
      ]);
      insertImports(db, [
        {
          file_path: "src/Parent.tsx",
          source: "./Child",
          resolved_path: "src/Child.tsx",
          specifiers: '["Child"]',
          is_type_only: 0,
          line_number: 1,
        },
      ]);

      const result = synthesizeCallbackCalls(db);
      expect(result.jsxEdges).toBe(1);
      const row = db
        .query<{ callee_name: string }>(
          "SELECT callee_name FROM calls WHERE provenance = 'heuristic'",
        )
        .get() as { callee_name: string };
      expect(row.callee_name).toBe("Child");
    } finally {
      closeDb(db);
    }
  });

  it("clears prior heuristic rows on re-run for a scoped file", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createSchema(db);
      seedMinimalReactFile(db);
      synthesizeCallbackCalls(db);
      synthesizeCallbackCalls(db, { filePaths: ["src/Parent.tsx"] });
      expect(
        (
          db.query<{ n: number }>("SELECT COUNT(*) AS n FROM calls").get() as {
            n: number;
          }
        ).n,
      ).toBe(1);
    } finally {
      closeDb(db);
    }
  });
});
