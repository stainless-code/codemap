import { describe, expect, it } from "bun:test";

import { resolveAuditBaselines } from "../application/audit-engine";
import { createTables, upsertQueryBaseline } from "../db";
import type { CodemapDatabase } from "../db";
import { openCodemapDatabase } from "../sqlite-db";
import { parseAuditRest } from "./cmd-audit";

function freshDb(): CodemapDatabase {
  const db = openCodemapDatabase(":memory:");
  createTables(db);
  return db;
}

function emptyBaseline(db: CodemapDatabase, name: string) {
  upsertQueryBaseline(db, {
    name,
    recipe_id: null,
    sql: "SELECT 1",
    rows_json: "[]",
    row_count: 0,
    git_ref: null,
    created_at: 1,
  });
}

describe("parseAuditRest", () => {
  it("errors when no flags given", () => {
    const r = parseAuditRest(["audit"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error")
      expect(r.message).toContain("missing snapshot source");
  });

  it("returns help on --help / -h", () => {
    expect(parseAuditRest(["audit", "--help"]).kind).toBe("help");
    expect(parseAuditRest(["audit", "-h"]).kind).toBe("help");
  });

  it("parses --baseline <prefix> (auto-resolve sugar)", () => {
    const r = parseAuditRest(["audit", "--baseline", "base"]);
    expect(r).toEqual({
      kind: "run",
      baselinePrefix: "base",
      base: undefined,
      perDelta: {},
      json: false,
      summary: false,
      noIndex: false,
    });
  });

  it("parses --baseline=<prefix>", () => {
    const r = parseAuditRest(["audit", "--baseline=base"]);
    expect(r).toEqual({
      kind: "run",
      baselinePrefix: "base",
      base: undefined,
      perDelta: {},
      json: false,
      summary: false,
      noIndex: false,
    });
  });

  it("parses each per-delta --<key>-baseline flag", () => {
    const r = parseAuditRest([
      "audit",
      "--files-baseline",
      "X",
      "--dependencies-baseline",
      "Y",
      "--deprecated-baseline",
      "Z",
    ]);
    expect(r).toEqual({
      kind: "run",
      baselinePrefix: undefined,
      base: undefined,
      perDelta: { files: "X", dependencies: "Y", deprecated: "Z" },
      json: false,
      summary: false,
      noIndex: false,
    });
  });

  it("parses --baseline + per-delta override (mixed mode)", () => {
    const r = parseAuditRest([
      "audit",
      "--baseline",
      "base",
      "--dependencies-baseline",
      "experimental-deps",
    ]);
    expect(r).toEqual({
      kind: "run",
      baselinePrefix: "base",
      base: undefined,
      perDelta: { dependencies: "experimental-deps" },
      json: false,
      summary: false,
      noIndex: false,
    });
  });

  it("parses --json --summary --no-index alongside baseline flags", () => {
    const r = parseAuditRest([
      "audit",
      "--json",
      "--summary",
      "--no-index",
      "--baseline",
      "base",
    ]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.json).toBe(true);
    expect(r.summary).toBe(true);
    expect(r.noIndex).toBe(true);
    expect(r.baselinePrefix).toBe("base");
  });

  it("errors when --baseline has no value", () => {
    const r = parseAuditRest(["audit", "--baseline"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--baseline");
  });

  it("errors when --baseline= has empty value", () => {
    const r = parseAuditRest(["audit", "--baseline="]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("non-empty");
  });

  it("errors when --files-baseline has no value", () => {
    const r = parseAuditRest(["audit", "--files-baseline"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--files-baseline");
  });

  it("errors when --baseline gets an empty-string value (two-token form)", () => {
    const r = parseAuditRest(["audit", "--baseline", ""]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--baseline");
  });

  it("errors when --files-baseline gets a whitespace-only value", () => {
    const r = parseAuditRest(["audit", "--files-baseline", "   "]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--files-baseline");
  });

  it("errors on unknown options", () => {
    const r = parseAuditRest(["audit", "--unknown", "x", "--baseline", "n"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--unknown");
  });

  it("parses --base <ref> alone", () => {
    const r = parseAuditRest(["audit", "--base", "origin/main"]);
    expect(r).toEqual({
      kind: "run",
      baselinePrefix: undefined,
      base: "origin/main",
      perDelta: {},
      json: false,
      summary: false,
      noIndex: false,
    });
  });

  it("parses --base=<ref>", () => {
    const r = parseAuditRest(["audit", "--base=HEAD~3"]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.base).toBe("HEAD~3");
  });

  it("rejects --base + --baseline (mutually exclusive)", () => {
    const r = parseAuditRest([
      "audit",
      "--base",
      "origin/main",
      "--baseline",
      "pr",
    ]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") {
      expect(r.message).toContain("mutually exclusive");
    }
  });

  it("allows --base + per-delta override (composes)", () => {
    const r = parseAuditRest([
      "audit",
      "--base",
      "origin/main",
      "--files-baseline",
      "pre-refactor",
    ]);
    if (r.kind !== "run") throw new Error("expected run");
    expect(r.base).toBe("origin/main");
    expect(r.perDelta).toEqual({ files: "pre-refactor" });
  });

  it("errors when --base has no value", () => {
    const r = parseAuditRest(["audit", "--base"]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--base");
  });

  it("errors when --base= has empty value", () => {
    const r = parseAuditRest(["audit", "--base="]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("non-empty");
  });

  it("errors when --base gets an empty-string value (two-token form)", () => {
    const r = parseAuditRest(["audit", "--base", ""]);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("--base");
  });
});

describe("resolveAuditBaselines", () => {
  it("auto-resolves <prefix>-<delta> for slots that exist in query_baselines", () => {
    const db = freshDb();
    try {
      emptyBaseline(db, "base-files");
      emptyBaseline(db, "base-deprecated");
      // No "base-dependencies" — slot stays absent.
      const map = resolveAuditBaselines({
        db,
        baselinePrefix: "base",
        perDelta: {},
      });
      expect(map).toEqual({
        files: "base-files",
        deprecated: "base-deprecated",
      });
    } finally {
      db.close();
    }
  });

  it("per-delta flags override auto-resolved slots", () => {
    const db = freshDb();
    try {
      emptyBaseline(db, "base-files");
      emptyBaseline(db, "base-dependencies");
      emptyBaseline(db, "experimental-deps");
      const map = resolveAuditBaselines({
        db,
        baselinePrefix: "base",
        perDelta: { dependencies: "experimental-deps" },
      });
      expect(map).toEqual({
        files: "base-files",
        dependencies: "experimental-deps",
      });
    } finally {
      db.close();
    }
  });

  it("uses only per-delta flags when no prefix is given", () => {
    const db = freshDb();
    try {
      emptyBaseline(db, "X");
      const map = resolveAuditBaselines({
        db,
        baselinePrefix: undefined,
        perDelta: { files: "X" },
      });
      expect(map).toEqual({ files: "X" });
    } finally {
      db.close();
    }
  });

  it("returns empty map when prefix matches nothing AND no per-delta flags", () => {
    const db = freshDb();
    try {
      const map = resolveAuditBaselines({
        db,
        baselinePrefix: "nonexistent",
        perDelta: {},
      });
      expect(map).toEqual({});
    } finally {
      db.close();
    }
  });
});
