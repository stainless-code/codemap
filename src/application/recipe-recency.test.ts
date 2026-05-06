import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveCodemapConfig } from "../config";
import { closeDb, createTables, openDb } from "../db";
import { initCodemap } from "../runtime";
import {
  loadRecipeRecency,
  pruneRecipeRecency,
  RECENCY_WINDOW_MS,
  recordRecipeRun,
  tryRecordRecipeRun,
} from "./recipe-recency";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "recipe-recency-"));
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

describe("recipe_recency — schema", () => {
  it("starts empty after createTables", () => {
    const db = openDb();
    try {
      const rows = db
        .query<{ n: number }>("SELECT COUNT(*) AS n FROM recipe_recency")
        .all();
      expect(rows[0]?.n).toBe(0);
    } finally {
      closeDb(db, { readonly: true });
    }
  });

  it("RECENCY_WINDOW_MS equals 90 days", () => {
    expect(RECENCY_WINDOW_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
});

describe("recordRecipeRun", () => {
  it("creates a row with run_count=1 on first call", () => {
    const db = openDb();
    try {
      recordRecipeRun({ db, recipeId: "fan-out", now: 1_000_000 });
      const row = db
        .query<{
          recipe_id: string;
          last_run_at: number;
          run_count: number;
        }>("SELECT recipe_id, last_run_at, run_count FROM recipe_recency")
        .get();
      expect(row).toEqual({
        recipe_id: "fan-out",
        last_run_at: 1_000_000,
        run_count: 1,
      });
    } finally {
      closeDb(db);
    }
  });

  it("increments run_count and updates last_run_at on subsequent calls", () => {
    const db = openDb();
    try {
      recordRecipeRun({ db, recipeId: "fan-out", now: 1_000_000 });
      recordRecipeRun({ db, recipeId: "fan-out", now: 2_000_000 });
      recordRecipeRun({ db, recipeId: "fan-out", now: 3_000_000 });
      const row = db
        .query<{ last_run_at: number; run_count: number }>(
          "SELECT last_run_at, run_count FROM recipe_recency WHERE recipe_id = 'fan-out'",
        )
        .get();
      expect(row).toEqual({ last_run_at: 3_000_000, run_count: 3 });
    } finally {
      closeDb(db);
    }
  });

  it("tracks distinct recipes in separate rows", () => {
    const db = openDb();
    try {
      recordRecipeRun({ db, recipeId: "fan-out", now: 1_000_000 });
      recordRecipeRun({ db, recipeId: "fan-in", now: 1_500_000 });
      recordRecipeRun({ db, recipeId: "fan-out", now: 2_000_000 });
      const rows = db
        .query<{
          recipe_id: string;
          last_run_at: number;
          run_count: number;
        }>(
          "SELECT recipe_id, last_run_at, run_count FROM recipe_recency ORDER BY recipe_id",
        )
        .all();
      expect(rows).toEqual([
        { recipe_id: "fan-in", last_run_at: 1_500_000, run_count: 1 },
        { recipe_id: "fan-out", last_run_at: 2_000_000, run_count: 2 },
      ]);
    } finally {
      closeDb(db);
    }
  });

  it("defaults `now` to Date.now() when omitted", () => {
    const db = openDb();
    try {
      const before = Date.now();
      recordRecipeRun({ db, recipeId: "fan-out" });
      const after = Date.now();
      const row = db
        .query<{ last_run_at: number }>(
          "SELECT last_run_at FROM recipe_recency WHERE recipe_id = 'fan-out'",
        )
        .get();
      expect(row?.last_run_at).toBeGreaterThanOrEqual(before);
      expect(row?.last_run_at).toBeLessThanOrEqual(after);
    } finally {
      closeDb(db);
    }
  });
});

describe("pruneRecipeRecency", () => {
  it("deletes rows whose last_run_at < cutoffMs", () => {
    const db = openDb();
    try {
      recordRecipeRun({ db, recipeId: "old-recipe", now: 1_000 });
      recordRecipeRun({ db, recipeId: "new-recipe", now: 9_999 });
      pruneRecipeRecency({ db, cutoffMs: 5_000 });
      const rows = db
        .query<{ recipe_id: string }>(
          "SELECT recipe_id FROM recipe_recency ORDER BY recipe_id",
        )
        .all();
      expect(rows).toEqual([{ recipe_id: "new-recipe" }]);
    } finally {
      closeDb(db);
    }
  });

  it("keeps rows where last_run_at == cutoffMs (strict <)", () => {
    const db = openDb();
    try {
      recordRecipeRun({ db, recipeId: "exactly-cutoff", now: 5_000 });
      pruneRecipeRecency({ db, cutoffMs: 5_000 });
      const rows = db
        .query<{ recipe_id: string }>("SELECT recipe_id FROM recipe_recency")
        .all();
      expect(rows).toEqual([{ recipe_id: "exactly-cutoff" }]);
    } finally {
      closeDb(db);
    }
  });

  it("is a no-op on an empty table", () => {
    const db = openDb();
    try {
      pruneRecipeRecency({ db, cutoffMs: Date.now() });
      const rows = db
        .query<{ n: number }>("SELECT COUNT(*) AS n FROM recipe_recency")
        .all();
      expect(rows[0]?.n).toBe(0);
    } finally {
      closeDb(db);
    }
  });
});

describe("loadRecipeRecency", () => {
  it("returns an empty Map when no recipes have run", () => {
    const db = openDb();
    try {
      const map = loadRecipeRecency({ db });
      expect(map.size).toBe(0);
    } finally {
      closeDb(db, { readonly: true });
    }
  });

  it("returns rows keyed by recipe_id", () => {
    const db = openDb();
    try {
      const now = Date.now();
      recordRecipeRun({ db, recipeId: "fan-out", now });
      recordRecipeRun({ db, recipeId: "fan-out", now });
      recordRecipeRun({ db, recipeId: "fan-in", now });
      const map = loadRecipeRecency({ db, now });
      expect(map.size).toBe(2);
      expect(map.get("fan-out")).toEqual({ last_run_at: now, run_count: 2 });
      expect(map.get("fan-in")).toEqual({ last_run_at: now, run_count: 1 });
    } finally {
      closeDb(db);
    }
  });

  it("filters out rows older than 90 days WITHOUT mutating the table (read purity)", () => {
    const db = openDb();
    try {
      const now = 100 * 24 * 60 * 60 * 1000;
      const tooOld = now - RECENCY_WINDOW_MS - 1;
      const justInside = now - RECENCY_WINDOW_MS + 1;
      // Raw INSERT — `recordRecipeRun` would eager-prune the ancient row.
      db.run(
        "INSERT INTO recipe_recency (recipe_id, last_run_at, run_count) VALUES (?, ?, 1)",
        ["ancient", tooOld],
      );
      db.run(
        "INSERT INTO recipe_recency (recipe_id, last_run_at, run_count) VALUES (?, ?, 1)",
        ["still-fresh", justInside],
      );
      const map = loadRecipeRecency({ db, now });
      expect(map.has("ancient")).toBe(false);
      expect(map.has("still-fresh")).toBe(true);
      // Read MUST NOT delete — ancient row still on disk.
      const rows = db
        .query<{ recipe_id: string }>(
          "SELECT recipe_id FROM recipe_recency ORDER BY recipe_id",
        )
        .all();
      expect(rows.map((r) => r.recipe_id)).toEqual(["ancient", "still-fresh"]);
    } finally {
      closeDb(db);
    }
  });
});

describe("recordRecipeRun — eager prune (write-side)", () => {
  it("deletes ancient rows alongside its upsert", () => {
    const db = openDb();
    try {
      const now = 100 * 24 * 60 * 60 * 1000;
      const tooOld = now - RECENCY_WINDOW_MS - 1;
      db.run(
        "INSERT INTO recipe_recency (recipe_id, last_run_at, run_count) VALUES (?, ?, 1)",
        ["ancient", tooOld],
      );
      recordRecipeRun({ db, recipeId: "fresh", now });
      const rows = db
        .query<{ recipe_id: string }>(
          "SELECT recipe_id FROM recipe_recency ORDER BY recipe_id",
        )
        .all();
      expect(rows.map((r) => r.recipe_id)).toEqual(["fresh"]);
    } finally {
      closeDb(db);
    }
  });
});

describe("tryRecordRecipeRun — failure isolation", () => {
  it("swallows openDb failures and emits a stderr warning", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) =>
      warnings.push(args.map((a) => String(a)).join(" "));
    try {
      expect(() =>
        tryRecordRecipeRun("any-recipe", {
          _openDb: () => {
            throw new Error("simulated openDb failure");
          },
        }),
      ).not.toThrow();
    } finally {
      console.warn = origWarn;
    }
    expect(
      warnings.some(
        (w) =>
          w.includes("[recency] write failed") &&
          w.includes("simulated openDb failure"),
      ),
    ).toBe(true);
  });

  it("respects quiet flag — no stderr warning emitted", () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) =>
      warnings.push(args.map((a) => String(a)).join(" "));
    try {
      tryRecordRecipeRun("any-recipe", {
        quiet: true,
        _openDb: () => {
          throw new Error("simulated failure");
        },
      });
    } finally {
      console.warn = origWarn;
    }
    expect(warnings).toEqual([]);
  });

  it("writes successfully when openDb succeeds (smoke for the production path)", () => {
    tryRecordRecipeRun("smoke-recipe");
    const db = openDb();
    try {
      const row = db
        .query<{ recipe_id: string; run_count: number }>(
          "SELECT recipe_id, run_count FROM recipe_recency WHERE recipe_id = 'smoke-recipe'",
        )
        .get();
      expect(row).toEqual({ recipe_id: "smoke-recipe", run_count: 1 });
    } finally {
      closeDb(db, { readonly: true });
    }
  });
});

describe("tryRecordRecipeRun — opt-out (recipe_recency: false)", () => {
  it("short-circuits the upsert when recipe_recency: false", () => {
    initCodemap(resolveCodemapConfig(projectRoot, { recipe_recency: false }));

    // Thrower factory — fires only if the short-circuit fails.
    let openDbCalled = false;
    tryRecordRecipeRun("opt-out-recipe", {
      _openDb: () => {
        openDbCalled = true;
        throw new Error("openDb should not be called when opt-out");
      },
    });
    expect(openDbCalled).toBe(false);

    initCodemap(resolveCodemapConfig(projectRoot, undefined));

    const db = openDb();
    try {
      const rows = db
        .query<{ n: number }>("SELECT COUNT(*) AS n FROM recipe_recency")
        .all();
      expect(rows[0]?.n).toBe(0);
    } finally {
      closeDb(db, { readonly: true });
    }
  });

  it("writes normally when recipe_recency: true (default)", () => {
    initCodemap(resolveCodemapConfig(projectRoot, { recipe_recency: true }));
    tryRecordRecipeRun("explicit-on-recipe");
    initCodemap(resolveCodemapConfig(projectRoot, undefined));

    const db = openDb();
    try {
      const row = db
        .query<{ recipe_id: string; run_count: number }>(
          "SELECT recipe_id, run_count FROM recipe_recency WHERE recipe_id = 'explicit-on-recipe'",
        )
        .get();
      expect(row).toEqual({ recipe_id: "explicit-on-recipe", run_count: 1 });
    } finally {
      closeDb(db, { readonly: true });
    }
  });
});
