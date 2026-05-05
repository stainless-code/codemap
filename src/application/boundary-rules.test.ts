import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb, reconcileBoundaryRules } from "../db";
import { initCodemap } from "../runtime";
import { runCodemapIndex } from "./run-index";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "boundary-rules-"));
  initCodemap(resolveCodemapConfig(projectRoot, undefined));
  const db = openDb();
  try {
    createTables(db);
  } finally {
    closeDb(db);
  }
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("boundary_rules — schema + reconciler", () => {
  it("starts empty when no rules configured", () => {
    const db = openDb();
    try {
      const rows = db
        .query<{ n: number }>("SELECT COUNT(*) AS n FROM boundary_rules")
        .all();
      expect(rows[0]?.n).toBe(0);
    } finally {
      closeDb(db, { readonly: true });
    }
  });

  it("populates rows from reconcileBoundaryRules", () => {
    const db = openDb();
    try {
      reconcileBoundaryRules(db, [
        {
          name: "ui-cant-touch-server",
          from_glob: "src/ui/*",
          to_glob: "src/server/*",
          action: "deny",
        },
      ]);
      const rows = db
        .query<{ name: string; action: string }>(
          "SELECT name, action FROM boundary_rules",
        )
        .all();
      expect(rows).toEqual([{ name: "ui-cant-touch-server", action: "deny" }]);
    } finally {
      closeDb(db);
    }
  });

  it("clears existing rows before inserting (idempotent)", () => {
    const db = openDb();
    try {
      reconcileBoundaryRules(db, [
        {
          name: "rule-a",
          from_glob: "a/*",
          to_glob: "b/*",
          action: "deny",
        },
      ]);
      reconcileBoundaryRules(db, [
        {
          name: "rule-b",
          from_glob: "c/*",
          to_glob: "d/*",
          action: "deny",
        },
      ]);
      const rows = db
        .query<{ name: string }>("SELECT name FROM boundary_rules")
        .all();
      expect(rows).toEqual([{ name: "rule-b" }]);
    } finally {
      closeDb(db);
    }
  });

  it("rolls back on duplicate name — preserves prior good state (atomic)", () => {
    const db = openDb();
    try {
      reconcileBoundaryRules(db, [
        { name: "good", from_glob: "a", to_glob: "b", action: "deny" },
      ]);
      expect(() =>
        reconcileBoundaryRules(db, [
          { name: "dup", from_glob: "a", to_glob: "b", action: "deny" },
          { name: "dup", from_glob: "c", to_glob: "d", action: "deny" },
        ]),
      ).toThrow();
      const rows = db
        .query<{ name: string }>(
          "SELECT name FROM boundary_rules ORDER BY name",
        )
        .all();
      expect(rows).toEqual([{ name: "good" }]);
    } finally {
      closeDb(db);
    }
  });

  it("rejects unknown actions via CHECK constraint", () => {
    const db = openDb();
    try {
      expect(() =>
        db.run(
          "INSERT INTO boundary_rules (name, from_glob, to_glob, action) VALUES ('bad', 'a', 'b', 'maybe')",
        ),
      ).toThrow();
    } finally {
      closeDb(db);
    }
  });

  it("survives a full rebuild (reconciler runs after dropAll)", async () => {
    initCodemap(
      resolveCodemapConfig(projectRoot, {
        boundaries: [
          {
            name: "ui-cant-touch-server",
            from_glob: "src/ui/*",
            to_glob: "src/server/*",
          },
        ],
      }),
    );
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "a.ts"), "export const A = 1;\n");

    const db = openDb();
    try {
      await runCodemapIndex(db, { mode: "full", quiet: true });
      const rows = db
        .query<{ name: string; action: string }>(
          "SELECT name, action FROM boundary_rules",
        )
        .all();
      expect(rows).toEqual([{ name: "ui-cant-touch-server", action: "deny" }]);
    } finally {
      closeDb(db);
    }
  });

  it("boundary-violations recipe joins dependencies × boundary_rules via GLOB", () => {
    const db = openDb();
    try {
      // Minimal fixture: two files + one violating edge + one allowed edge.
      db.run(
        "INSERT INTO files (path, content_hash, size, line_count, language, last_modified, indexed_at) VALUES ('src/ui/button.ts', 'h1', 1, 1, 'typescript', 1, 1), ('src/server/db.ts', 'h2', 1, 1, 'typescript', 1, 1), ('src/shared/util.ts', 'h3', 1, 1, 'typescript', 1, 1)",
      );
      db.run(
        "INSERT INTO dependencies (from_path, to_path) VALUES ('src/ui/button.ts', 'src/server/db.ts'), ('src/ui/button.ts', 'src/shared/util.ts')",
      );
      reconcileBoundaryRules(db, [
        {
          name: "ui-cant-touch-server",
          from_glob: "src/ui/*",
          to_glob: "src/server/*",
          action: "deny",
        },
      ]);
      const rows = db
        .query<{
          file_path: string;
          to_path: string;
          rule_name: string;
        }>(
          `SELECT
             d.from_path AS file_path,
             d.to_path,
             b.name AS rule_name
           FROM dependencies d
           JOIN boundary_rules b
             ON b.action = 'deny'
            AND d.from_path GLOB b.from_glob
            AND d.to_path GLOB b.to_glob
           ORDER BY d.from_path, d.to_path`,
        )
        .all();
      expect(rows).toEqual([
        {
          file_path: "src/ui/button.ts",
          to_path: "src/server/db.ts",
          rule_name: "ui-cant-touch-server",
        },
      ]);
    } finally {
      closeDb(db);
    }
  });
});
