import { describe, expect, it } from "bun:test";

import {
  closeDb,
  createTables,
  getMeta,
  getAllFileHashes,
  SCHEMA_VERSION,
  setMeta,
} from "./db";
import { openCodemapDatabase } from "./sqlite-db";

describe("SQLite layer (in-memory)", () => {
  it("creates schema and round-trips meta", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      setMeta(db, "schema_version", String(SCHEMA_VERSION));
      expect(getMeta(db, "schema_version")).toBe(String(SCHEMA_VERSION));
      expect(getMeta(db, "missing")).toBeUndefined();
    } finally {
      closeDb(db);
    }
  });

  it("getAllFileHashes is empty on fresh DB", () => {
    const db = openCodemapDatabase(":memory:");
    try {
      createTables(db);
      expect(getAllFileHashes(db).size).toBe(0);
    } finally {
      closeDb(db);
    }
  });
});
